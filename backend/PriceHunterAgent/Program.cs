using PriceHunterAgent.Agent;
using PriceHunterAgent.Agent.Tools;
using PriceHunterAgent.Providers;

var builder = WebApplication.CreateBuilder(args);

// ── Services ──────────────────────────────────────────────────────────────────

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
    c.SwaggerDoc("v1", new() { Title = "AI Price Hunter API", Version = "v1" }));

// HttpClient pool
builder.Services.AddHttpClient();

// ── Default LLM Provider (swap via appsettings.json "LlmProvider") ───────────
//
//   "DeepSeek"    → DeepSeek V4 Pro  (API key from frontend settings panel)
//   "Anthropic"   → Claude Sonnet    (needs Anthropic:ApiKey)
//   "OpenAI"      → GPT-4o           (needs OpenAI:ApiKey)
//   "Groq"        → Llama 3.3 70B    (needs Groq:ApiKey)
//   "Ollama"      → local models     (no key needed)
//
builder.Services.AddSingleton<ILlmProvider>(sp => LlmProviderFactory.Create(sp));

// ── Browser-Use tool (calls Python microservice) ──────────────────────────────
builder.Services.AddScoped<BrowserSearchTool>();

// ── Login session coordinator (singleton — survives across scopes) ────────────
builder.Services.AddSingleton<LoginSessionStore>();

// ── Agent (scoped — one instance per HTTP request) ────────────────────────────
builder.Services.AddScoped<PriceHunterAgentService>();

// ── Legacy tools kept for reference (not used by new agent) ──────────────────
builder.Services.AddScoped<WebSearchTool>();
builder.Services.AddScoped<PriceFetchTool>(sp =>
    new PriceFetchTool(sp.GetRequiredService<IHttpClientFactory>().CreateClient()));
builder.Services.AddScoped<CouponSearchTool>();

// ── CORS ──────────────────────────────────────────────────────────────────────
builder.Services.AddCors(options =>
    options.AddPolicy("AllowAll", policy =>
        policy.AllowAnyOrigin()
              .AllowAnyHeader()
              .AllowAnyMethod()));

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors("AllowAll");
app.UseAuthorization();
app.MapControllers();

var provider = app.Services.GetRequiredService<ILlmProvider>();
app.Logger.LogInformation("AI Price Hunter started. Default LLM: {Provider}", provider.Name);

app.Run();
