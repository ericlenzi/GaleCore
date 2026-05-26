using System.Reflection;
using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;
using MediatR;
using DataFeed.Infrastructure;
using DataFeed.Infrastructure.Providers.Tastytrade;
using DataFeed.Api.Hubs;
using DataFeed.Api.Infrastructure;
using ModelContextProtocol.AspNetCore;

namespace DataFeed
{
    public class Program
    {
        public static void Main(string[] args)
        {
            var builder = WebApplication.CreateBuilder(args);

            // Controllers + Newtonsoft
            builder.Services.AddControllers()
                .AddNewtonsoftJson(options =>
                {
                    options.SerializerSettings.ReferenceLoopHandling = ReferenceLoopHandling.Ignore;
                });

            // Swagger
            builder.Services.AddEndpointsApiExplorer();
            builder.Services.AddSwaggerGen();

            // MediatR
            builder.Services.AddMediatR(cfg => cfg.RegisterServicesFromAssemblies(Assembly.Load("DataFeed.Application")));

            // AutoMapper
            builder.Services.AddAutoMapper(cfg => { }, Assembly.Load("DataFeed.Application"));

            // CORS
            builder.Services.AddCors(options =>
            {
                options.AddPolicy("ReactAppPolicy", policy =>
                {
                    policy.WithOrigins("http://localhost:3039", "https://localhost:3039",
                                       "http://localhost:5173", "https://localhost:5173",
                                       "https://galecore-monitor.vercel.app",
                                       "https://gale-core-monitor.vercel.app",
                                       "https://galecore.vercel.app")
                          .AllowAnyHeader()
                          .AllowAnyMethod()
                          .AllowCredentials();
                });
            });

            // HttpClient + OAuth
            builder.Services.AddHttpClient();
            builder.Services.AddSingleton<ITastytradeOAuth, TastytradeOAuth>();

            // SignalR
            builder.Services.AddSignalR()
                .AddNewtonsoftJsonProtocol(options =>
                {
                    options.PayloadSerializerSettings.ReferenceLoopHandling = ReferenceLoopHandling.Ignore;
                    options.PayloadSerializerSettings.ContractResolver = new CamelCasePropertyNamesContractResolver();
                });

            // Streaming: DxLink persistente + broadcaster SignalR
            builder.Services.AddSingleton<IMarketDataBroadcaster, MarketDataBroadcaster>();
            builder.Services.AddSingleton<DxLinkStreamingService>();
            builder.Services.AddSingleton<IDxLinkStreamingService>(sp => sp.GetRequiredService<DxLinkStreamingService>());
            builder.Services.AddHostedService(sp => sp.GetRequiredService<DxLinkStreamingService>());

            // MCP Server
            builder.Services
                .AddMcpServer()
                .WithHttpTransport()
                .WithToolsFromAssembly();

            builder.Host.UseDefaultServiceProvider(options =>
                options.ValidateScopes = false);

            var app = builder.Build();

            // Pipeline (orden corregido)
            app.UseMiddleware<ExceptionHandlerMiddleware>();

            if (app.Environment.IsDevelopment())
            {
                app.UseDeveloperExceptionPage();
            }

            app.UseSwagger();
            app.UseSwaggerUI(c =>
            {
                c.SwaggerEndpoint("/swagger/v1/swagger.json", "DataFeed v1");
            });

            app.UseStaticFiles();
            app.UseCors("ReactAppPolicy");

            app.UseMiddleware<ApiKeyMiddleware>();

            //app.MapGet("/health", () => "DataFeed OK");
            app.MapControllers();
            app.MapHub<MarketDataHub>("/hubs/marketdata");
            app.MapMcp("/mcp");

            app.Run();
        }
    }
}
