using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.RegularExpressions;
using PriceHunterAgent.Agent.Models;
using PriceHunterAgent.Agent.Tools;
using PriceHunterAgent.Providers;

namespace PriceHunterAgent.Agent;

/// <summary>
/// ReAct agent that orchestrates price comparison across Chinese e-commerce platforms
/// (JD.com, Taobao, Pinduoduo) using the DeepSeek LLM and Browser-Use automation.
///
/// Login interruptions: when the browser service detects a login page it returns
/// LOGIN_REQUIRED:{platform}:{taskId}. The agent yields a login_required step,
/// waits via LoginSessionStore, then continues polling once the user has logged in.
/// </summary>
public class PriceHunterAgentService
{
    private readonly ILlmProvider        _defaultProvider;
    private readonly BrowserSearchTool   _browserTool;
    private readonly LoginSessionStore   _sessionStore;
    private readonly IHttpClientFactory  _httpFactory;
    private readonly IConfiguration      _config;

    private const string SystemPrompt = """
        你是一个专业的AI比价购物助手，专门在中国各大电商平台寻找最优惠的商品。

        【重要规则】每次调用工具之前，你必须先用中文输出你的分析和决策思路（2-4句话），
        说明你打算做什么、为什么这样做。这段思考内容要先于工具调用出现在你的回复中。

        你的目标：
        1. 调用一次 browser_search，在京东、淘宝、拼多多三个平台搜索商品
        2. browser_search 会自动点开每个平台前5个商品详情页，提取价格、评价、销量、优惠券信息
        3. 根据返回的真实数据综合对比，给出最优惠的购买建议

        数据准确性要求：
        - 必须使用工具返回的真实数据，绝对不要编造任何价格或评价数据
        - 以 ¥XX.XX 格式展示人民币价格
        - 用 [商品名](链接) markdown 格式展示商品链接

        最终报告格式：
        ### 京东
        1. **商品名称** — ¥XX.XX | [店铺名](链接)
           - 评价：XXXX条 | 优惠券：XX

        ### 淘宝
        （同上）

        ### 拼多多
        （同上）

        ---
        ### 购买建议
        综合对比后，推荐在【平台】购买【商品名】，理由：价格最低/优惠券最大/评价最好等。
        """;

    private static readonly List<ToolDefinition> ToolDefs = new()
    {
        new ToolDefinition
        {
            Name        = "browser_search",
            Description = "使用浏览器在京东、淘宝、拼多多同时搜索商品。会自动点开每个平台前5个商品详情页，提取价格、销量、评价、优惠券信息后关闭，最后汇总返回。整个比价流程只调用一次，不要重复调用。",
            InputSchema = new ToolInputSchema
            {
                Properties = new()
                {
                    ["product"]   = new() { Type = "string",
                        Description = "要搜索的商品名称，例如 'iPhone 15 Pro Max 256GB'" },
                    ["platforms"] = new() { Type = "string",
                        Description = "固定填写 'jd,taobao,pdd'，一次搜索三个平台" }
                },
                Required = ["product", "platforms"]
            }
        }
    };

    public PriceHunterAgentService(
        ILlmProvider defaultProvider,
        BrowserSearchTool browserTool,
        LoginSessionStore sessionStore,
        IHttpClientFactory httpFactory,
        IConfiguration config)
    {
        _defaultProvider = defaultProvider;
        _browserTool     = browserTool;
        _sessionStore    = sessionStore;
        _httpFactory     = httpFactory;
        _config          = config;
    }

    public async IAsyncEnumerable<AgentStep> RunAsync(
        string product,
        string apiKey,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        // Use per-request key if provided, otherwise fall back to configured provider
        ILlmProvider llm = !string.IsNullOrWhiteSpace(apiKey)
            ? LlmProviderFactory.CreateDeepSeekWithKey(_httpFactory, _config, apiKey)
            : _defaultProvider;

        var history = new List<ChatMessage>();
        history.Add(new ChatMessage
        {
            Role = "user",
            Content = $"""
                请帮我在各大电商平台比价：{product}

                请按以下步骤进行：
                1. 调用一次 browser_search，product 填商品名，platforms 填 jd,taobao,pdd
                   （工具会自动在三个平台各点开前5个商品详情页，提取价格、评价、优惠券后汇总）
                2. 根据返回的真实数据，对比三个平台的价格、销量、评价、优惠券
                3. 给出最终购买建议：推荐哪个平台、哪款商品，理由是什么
                """
        });

        yield return new AgentStep
        {
            Type    = "thinking",
            Message = $"开始在各大电商平台比价：**{product}**\n_AI模型：{llm.Name}_"
        };

        const int maxIterations = 15;
        for (int i = 0; i < maxIterations; i++)
        {
            if (ct.IsCancellationRequested) yield break;

            LlmResponse response = null!;
            string? llmError = null;
            try
            {
                response = await llm.CompleteAsync(SystemPrompt, history, ToolDefs, ct);
            }
            catch (Exception ex)
            {
                llmError = $"AI请求失败 ({llm.Name}): {ex.Message}";
            }

            if (llmError != null)
            {
                yield return new AgentStep { Type = "error", Message = llmError };
                yield break;
            }

            // ── Tool call(s) ─────────────────────────────────────────────────
            if (response.IsToolCall)
            {
                // Emit the model's reasoning/pre-decision text as a thinking step
                if (!string.IsNullOrWhiteSpace(response.Thinking))
                {
                    yield return new AgentStep
                    {
                        Type    = "thinking",
                        Message = response.Thinking
                    };
                }

                var toolCalls = response.AllToolCalls.Count > 0
                    ? response.AllToolCalls
                    : new List<ToolCallRequest> { response.ToolCall! };

                history.Add(new ChatMessage
                {
                    Role    = "assistant",
                    Content = response.RawContent
                });

                var toolResults = new List<object>();

                foreach (var toolCall in toolCalls)
                {
                    yield return new AgentStep
                    {
                        Type    = "tool_call",
                        Message = FormatToolCallMessage(toolCall.Name, toolCall.Input),
                        Data    = new { tool = toolCall.Name, input = toolCall.Input }
                    };

                    string result;
                    try
                    {
                        result = await ExecuteToolAsync(toolCall.Name, toolCall.Input, apiKey, ct);
                    }
                    catch (Exception ex)
                    {
                        result = $"工具执行出错: {ex.Message}";
                    }

                    // ── Handle login interruptions (may repeat for multiple platforms) ──
                    while (result.StartsWith(BrowserSearchTool.LoginRequiredPrefix))
                    {
                        var remainder = result[BrowserSearchTool.LoginRequiredPrefix.Length..];
                        var colonIdx  = remainder.IndexOf(':');
                        var platform  = colonIdx >= 0 ? remainder[..colonIdx] : remainder;
                        var taskId    = colonIdx >= 0 ? remainder[(colonIdx + 1)..] : "";

                        yield return new AgentStep
                        {
                            Type    = "login_required",
                            Message = $"需要在 {platform} 登录，请在上方浏览器窗口中完成登录（扫码或输入账号密码），完成后点击「已完成登录」按钮继续。",
                            Data    = new { platform, taskId }
                        };

                        // Block until AgentController.Resume signals us
                        await _sessionStore.WaitForLoginAsync(taskId, ct);

                        // Continue polling — Python browser resumed after /resume was called
                        result = await _browserTool.ContinuePollAsync(taskId, ct);
                    }

                    yield return new AgentStep
                    {
                        Type    = "tool_result",
                        Message = result,
                        Data    = new { tool = toolCall.Name }
                    };

                    toolResults.Add(new
                    {
                        type        = "tool_result",
                        tool_use_id = toolCall.Id,
                        content     = result
                    });
                }

                history.Add(new ChatMessage
                {
                    Role    = "user",
                    Content = toolResults
                });

                continue;
            }

            // ── Final answer ──────────────────────────────────────────────────
            var finalText = response.Text ?? "";
            history.Add(new ChatMessage { Role = "assistant", Content = finalText });

            yield return new AgentStep
            {
                Type    = "answer",
                Message = finalText,
                Data    = BuildPriceReport(product, finalText)
            };

            yield break;
        }

        yield return new AgentStep
        {
            Type    = "error",
            Message = "Agent 已达到最大迭代次数，未能完成比价。请重新搜索。"
        };
    }

    private async Task<string> ExecuteToolAsync(
        string name, JsonElement input, string apiKey, CancellationToken ct)
    {
        switch (name)
        {
            case "browser_search":
            {
                var prod      = input.GetProperty("product").GetString()!;
                var platStr   = input.TryGetProperty("platforms", out var pEl)
                                    ? pEl.GetString() ?? "jd,taobao,pdd"
                                    : "jd,taobao,pdd";
                var platforms = platStr.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
                return await _browserTool.SearchAsync(prod, platforms, apiKey, ct);
            }

            default:
                return $"未知工具: {name}";
        }
    }

    private static string FormatToolCallMessage(string name, JsonElement input) =>
        name switch
        {
            "browser_search" => FormatBrowserSearchMsg(input),
            _                => $"调用工具：{name}"
        };

    private static string FormatBrowserSearchMsg(JsonElement input)
    {
        var product  = input.TryGetProperty("product",   out var p)  ? p.GetString()  ?? "" : "";
        var platform = input.TryGetProperty("platforms", out var pl) ? pl.GetString() ?? "全部" : "全部";
        return $"正在浏览器中搜索「{product}」— 平台：{platform}（将逐一点开前5个商品，含优惠券）";
    }

    // ── Build structured price report from agent's final markdown answer ──────

    private static PriceReport BuildPriceReport(string product, string agentAnswer)
    {
        var listings = new List<PriceListing>();
        var lines    = agentAnswer.Split('\n', StringSplitOptions.RemoveEmptyEntries);

        foreach (var line in lines)
        {
            // Match markdown link: [text](url)
            var urlMatch = Regex.Match(line, @"\[([^\]]+)\]\((https?://[^\)]+)\)");
            // Match CNY price: ¥XX or ￥XX
            var priceMatch = Regex.Match(line, @"[¥￥]([\d,]+\.?\d*)");

            if (!priceMatch.Success) continue;

            var priceStr = "¥" + priceMatch.Groups[1].Value;
            var numericStr = priceMatch.Groups[1].Value.Replace(",", "");
            double.TryParse(numericStr, out var priceNumeric);

            var store = urlMatch.Success ? urlMatch.Groups[1].Value : ExtractPlatformName(line);
            var url   = urlMatch.Success ? urlMatch.Groups[2].Value : "";

            if (listings.Any(l => l.Store == store)) continue;

            var notes = "";
            if (line.Contains("免运费") || line.Contains("包邮")) notes = "包邮";
            else if (line.Contains("自营")) notes = "官方自营";

            listings.Add(new PriceListing
            {
                Store        = store,
                Price        = priceStr,
                PriceNumeric = priceNumeric,
                Url          = url,
                Notes        = notes,
                IsBestPrice  = false
            });
        }

        if (listings.Count > 0)
        {
            var cheapest = listings.MinBy(l => l.PriceNumeric);
            if (cheapest != null) cheapest.IsBestPrice = true;
        }

        // Extract coupon if mentioned: "XX元券" or "满XX减XX"
        var couponMatch = Regex.Match(agentAnswer, @"(满\d+减\d+|\d+元(?:无门槛)?券|立减\d+)", RegexOptions.IgnoreCase);
        var coupon = couponMatch.Success ? couponMatch.Value : null;

        var answerUpper = agentAnswer.ToUpper();
        var recommendation = answerUpper.Contains("等待") || answerUpper.Contains("等一等")
            ? "WAIT"
            : answerUpper.Contains("立即购买") || answerUpper.Contains("推荐购买") || answerUpper.Contains("超值")
                ? "BUY_NOW"
                : "COMPARE";

        var bestDealLine = lines.FirstOrDefault(l =>
            l.Contains("推荐") || l.Contains("最优") || l.Contains("最划算") || l.Contains("购买建议"))
            ?.Trim().TrimStart('#', '*', ' ');

        return new PriceReport
        {
            Product              = product,
            Recommendation       = recommendation,
            RecommendationReason = agentAnswer,
            SearchedAt           = DateTime.UtcNow,
            Listings             = listings,
            BestDeal             = bestDealLine ?? "",
            CouponFound          = coupon
        };
    }

    private static string ExtractPlatformName(string line)
    {
        if (line.Contains("京东") || line.Contains("JD")) return "京东";
        if (line.Contains("淘宝") || line.Contains("天猫") || line.Contains("Taobao")) return "淘宝";
        if (line.Contains("拼多多") || line.Contains("PDD")) return "拼多多";
        return "电商平台";
    }
}
