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

            // Un JWT válido ya identifica a una persona, que es MÁS de lo que prueba una clave
            // compartida: la clave dice "alguien que la tiene", el token dice quién. Aceptarlo es lo
            // que permite que el tablero deje de cargar una API key en su bundle.
            //
            // La clave sigue valiendo para lo que no puede loguearse: llamadas de máquina a máquina,
            // pruebas con curl, y el propio tablero hasta que termine de migrar al login.
            if (context.User?.Identity?.IsAuthenticated == true)
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
