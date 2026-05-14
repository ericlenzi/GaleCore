using MediatR;
using System.Text.Json.Serialization;

namespace DataFeed.Application.App.ValidationLayer
{
    public class ValidationLayerRequest : IRequest<ValidationLayerResponse>
    {
        public string Symbol { get; set; }
        public string Profile { get; set; } = "core";
        public string? AccountNumber { get; set; }

        [JsonIgnore]
        public string? RulesJson { get; set; }
    }
}
