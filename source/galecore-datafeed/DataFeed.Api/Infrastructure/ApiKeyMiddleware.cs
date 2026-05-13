namespace DataFeed.Infrastructure
{
    public class ApiKeyMiddleware
    {
        private readonly RequestDelegate _next;
        private const string ApiKeyHeaderName = "X-API-KEY";

        public ApiKeyMiddleware(RequestDelegate next)
        {
            _next = next;
        }

        public async Task InvokeAsync(HttpContext context, IConfiguration configuration)
        {
            var path = context.Request.Path.Value ?? string.Empty;

            if (path.StartsWith("/swagger") || path.StartsWith("/favicon.ico") || path.StartsWith("/mcp") || path.StartsWith("/hubs"))
            {
                await _next(context);
                return;
            }

            if (!context.Request.Headers.TryGetValue(ApiKeyHeaderName, out var apiKeyHeader))
            {
                context.Response.StatusCode = 401;
                await context.Response.WriteAsync("API Key header is missing");
                return;
            }

            var configuredKey = configuration.GetValue<string>("ApiKey");

            if (string.IsNullOrEmpty(configuredKey) || !configuredKey.Equals(apiKeyHeader.ToString().Trim()))
            {
                context.Response.StatusCode = 401;
                await context.Response.WriteAsync("Invalid API Key");
                return;
            }

            await _next(context);
        }
    }
}
