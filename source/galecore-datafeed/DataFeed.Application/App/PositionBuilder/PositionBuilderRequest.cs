using MediatR;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace DataFeed.Application.App.PositionBuilder
{
    public class PositionBuilderRequest : IRequest<PositionBuilderResponse>
    {
        public string Symbol { get; set; }
        public string Profile { get; set; } = "core";
        public string? AccountNumber { get; set; }

        [JsonIgnore]
        public string? RulesJson { get; set; }
    }
}
