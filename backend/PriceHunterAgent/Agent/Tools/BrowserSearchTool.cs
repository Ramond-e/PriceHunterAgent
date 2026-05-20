using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace PriceHunterAgent.Agent.Tools;

/// <summary>
/// Calls the Python Browser-Use microservice to perform real browser automation
/// on Chinese e-commerce platforms (JD, Taobao, Pinduoduo).
///
/// The Python service runs Playwright Chromium in headed mode inside a Docker
/// container with Xvfb virtual display. It signals LOGIN_REQUIRED when a login
/// page is detected, then waits for the user to complete login via noVNC.
///
/// Result polling protocol:
///   POST /search         → {task_id}                 (starts async task)
///   GET  /result/{id}    → {status, result, ...}     (poll for completion)
///   POST /resume/{id}    → {status: "resumed"}       (unblock after login)
///   POST /coupon         → {task_id}                 (starts coupon task)
/// </summary>
public class BrowserSearchTool
{
    private readonly HttpClient _http;

    // Prefix returned when a login page is detected — agent service checks for this
    public const string LoginRequiredPrefix = "LOGIN_REQUIRED:";

    public BrowserSearchTool(IHttpClientFactory factory, IConfiguration config)
    {
        var baseUrl = config["BrowserServiceUrl"] ?? "http://localhost:8000";
        _http = factory.CreateClient();
        _http.BaseAddress = new Uri(baseUrl.TrimEnd('/') + "/");
        _http.Timeout = TimeSpan.FromMinutes(10);
    }

    /// <summary>
    /// Starts a product search across the specified platforms.
    /// Returns either the JSON result string or "LOGIN_REQUIRED:{platform}:{taskId}".
    /// </summary>
    public async Task<string> SearchAsync(
        string product,
        string[] platforms,
        string apiKey,
        CancellationToken ct)
    {
        var body = new
        {
            product,
            api_key = apiKey,
            platforms
        };
        using var request = new HttpRequestMessage(HttpMethod.Post, "search")
        {
            Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"),
        };
        if (!string.IsNullOrWhiteSpace(apiKey))
            request.Headers.TryAddWithoutValidation("X-DeepSeek-Api-Key", apiKey);

        var resp = await _http.SendAsync(request, ct);

        resp.EnsureSuccessStatusCode();
        var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
        var taskId = doc.RootElement.GetProperty("task_id").GetString()!;

        return await PollUntilDoneAsync(taskId, ct);
    }

    /// <summary>
    /// Resume-polls an existing task after the user has completed manual login.
    /// </summary>
    public async Task<string> ContinuePollAsync(string taskId, CancellationToken ct)
        => await PollUntilDoneAsync(taskId, ct);

    /// <summary>
    /// Starts a coupon search for a specific product URL.
    /// Returns either the coupon result or "LOGIN_REQUIRED:{platform}:{taskId}".
    /// </summary>
    public async Task<string> FindCouponsAsync(
        string platform,
        string product,
        string url,
        string apiKey,
        CancellationToken ct)
    {
        var body = new { platform, product, url, api_key = apiKey };
        using var request = new HttpRequestMessage(HttpMethod.Post, "coupon")
        {
            Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"),
        };
        if (!string.IsNullOrWhiteSpace(apiKey))
            request.Headers.TryAddWithoutValidation("X-DeepSeek-Api-Key", apiKey);

        var resp = await _http.SendAsync(request, ct);

        resp.EnsureSuccessStatusCode();
        var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
        var taskId = doc.RootElement.GetProperty("task_id").GetString()!;

        return await PollUntilDoneAsync(taskId, ct);
    }

    // ── Internal polling loop ────────────────────────────────────────────────

    private async Task<string> PollUntilDoneAsync(string taskId, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            await Task.Delay(2000, ct);

            HttpResponseMessage resp;
            try
            {
                resp = await _http.GetAsync($"result/{taskId}", ct);
            }
            catch (Exception ex)
            {
                return $"浏览器服务连接失败: {ex.Message}";
            }

            if (!resp.IsSuccessStatusCode)
                return $"浏览器服务错误: HTTP {resp.StatusCode}";

            var body = await resp.Content.ReadAsStringAsync(ct);
            var doc  = JsonDocument.Parse(body);
            var root = doc.RootElement;

            var status = root.TryGetProperty("status", out var s) ? s.GetString() : "unknown";

            switch (status)
            {
                case "completed":
                    return root.TryGetProperty("result", out var r) ? r.GetString() ?? "" : "";

                case "login_required":
                    var platform = root.TryGetProperty("login_platform", out var lp)
                        ? lp.GetString() ?? "平台"
                        : "平台";
                    return $"{LoginRequiredPrefix}{platform}:{taskId}";

                case "error":
                    var error = root.TryGetProperty("error", out var e)
                        ? e.GetString() ?? "未知错误"
                        : "未知错误";
                    return $"搜索出错: {error}";

                case "not_found":
                    return "任务不存在";

                // "running" — continue polling
            }
        }

        return "搜索已取消";
    }
}
