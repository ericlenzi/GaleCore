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

        /// <summary>Contenido de Files/pop_calibration.json (tabla POP empírica del gate edge). Inyectado por AppController.</summary>
        [JsonIgnore]
        public string? PopCalibrationJson { get; set; }

        /// <summary>Contenido de Files/skew25_history.json (serie diaria para el RoC 5d de tail_score). Inyectado por AppController.</summary>
        [JsonIgnore]
        public string? SkewHistoryJson { get; set; }
    }
}
