using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using PriceHunterAgent.Agent;

namespace PriceHunterAgent.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AgentController : ControllerBase
{
    private readonly PriceHunterAgentService _agent;
    private readonly LoginSessionStore       _sessionStore;
    private readonly IHttpClientFactory      _httpFactory;
    private readonly IConfiguration          _config;
    private readonly ILogger<AgentController> _logger;

    public AgentController(
        PriceHunterAgentService agent,
        LoginSessionStore sessionStore,
        IHttpClientFactory httpFactory,
        IConfiguration config,
        ILogger<AgentController> logger)
    {
        _agent        = agent;
        _sessionStore = sessionStore;
        _httpFactory  = httpFactory;
        _config       = config;
        _logger       = logger;
    }

    /// <summary>
    /// POST /api/agent/search
    /// Streams agent steps as Server-Sent Events.
    /// Body: { "product": "...", "apiKey": "sk-..." }
    /// </summary>
    [HttpPost("search")]
    public async Task Search([FromBody] SearchRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Product))
        {
            Response.StatusCode = 400;
            return;
        }

        Response.Headers["Content-Type"]      = "text/event-stream";
        Response.Headers["Cache-Control"]     = "no-cache";
        Response.Headers["Connection"]        = "keep-alive";
        Response.Headers["X-Accel-Buffering"] = "no";

        _logger.LogInformation("Starting price hunt for: {Product}", request.Product);

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);

        // Serialize all writes through a semaphore — Response.Body is not thread-safe.
        var writeLock = new SemaphoreSlim(1, 1);

        async Task WriteAsync(byte[] data)
        {
            await writeLock.WaitAsync(cts.Token);
            try
            {
                await Response.Body.WriteAsync(data, cts.Token);
                await Response.Body.FlushAsync(cts.Token);
            }
            finally { writeLock.Release(); }
        }

        // Background keepalive: send SSE comment every 15 s so the browser
        // does not drop the connection during long browser-use searches or login waits.
        var pingBytes = Encoding.UTF8.GetBytes(": keepalive\n\n");
        var keepaliveTask = Task.Run(async () =>
        {
            try
            {
                while (!cts.Token.IsCancellationRequested)
                {
                    await Task.Delay(TimeSpan.FromSeconds(15), cts.Token);
                    await WriteAsync(pingBytes);
                }
            }
            catch { /* stream closed or cancelled — ignore */ }
        }, cts.Token);

        try
        {
            var jsonOpts = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
            await foreach (var step in _agent.RunAsync(request.Product, request.ApiKey ?? "", cts.Token))
            {
                if (cts.Token.IsCancellationRequested) break;
                var bytes = Encoding.UTF8.GetBytes($"data: {JsonSerializer.Serialize(step, jsonOpts)}\n\n");
                await WriteAsync(bytes);
            }

            await WriteAsync(Encoding.UTF8.GetBytes("data: [DONE]\n\n"));
        }
        catch (OperationCanceledException)
        {
            // Client disconnected — nothing to do
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unhandled error in SSE stream for product: {Product}", request.Product);
            // Send a proper SSE error event so the frontend shows a clean error instead of
            // "Error in input stream" (which happens when the TCP connection closes abruptly).
            try
            {
                var errPayload = JsonSerializer.Serialize(
                    new { type = "error", content = $"服务器错误：{ex.Message}" },
                    new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
                await WriteAsync(Encoding.UTF8.GetBytes($"data: {errPayload}\n\n"));
                await WriteAsync(Encoding.UTF8.GetBytes("data: [DONE]\n\n"));
            }
            catch { /* stream already gone */ }
        }
        finally
        {
            await cts.CancelAsync();   // stop keepalive loop
            try { await keepaliveTask; } catch { }
        }
    }

    /// <summary>
    /// POST /api/agent/resume/{taskId}
    /// Called by the frontend after the user completes manual login in the noVNC window.
    /// 1. Calls Python browser-service /resume/{taskId} to unblock the browser agent.
    /// 2. Signals LoginSessionStore to unblock the waiting C# agent loop.
    /// </summary>
    [HttpPost("resume/{taskId}")]
    public async Task<IActionResult> Resume(string taskId, CancellationToken ct)
    {
        _logger.LogInformation("Resume requested for task: {TaskId}", taskId);

        // Tell Python service to unblock the browser agent
        try
        {
            var browserUrl = _config["BrowserServiceUrl"] ?? "http://localhost:8000";
            var http = _httpFactory.CreateClient();
            http.Timeout = TimeSpan.FromSeconds(10);
            await http.PostAsync($"{browserUrl.TrimEnd('/')}/resume/{taskId}",
                content: null, ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning("Could not reach browser service for resume: {Msg}", ex.Message);
        }

        // Unblock the C# agent loop waiting for login
        var signalled = _sessionStore.Resume(taskId);
        return Ok(new { status = signalled ? "resumed" : "not_found" });
    }

    /// <summary>
    /// GET /api/agent/health
    /// </summary>
    [HttpGet("health")]
    public IActionResult Health() => Ok(new { status = "ok", timestamp = DateTime.UtcNow });
}

public record SearchRequest(string Product, string? ApiKey = null);
