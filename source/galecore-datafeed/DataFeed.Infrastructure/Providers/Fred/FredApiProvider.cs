using Microsoft.Extensions.Configuration;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using DataFeed.Infrastructure.Providers;
using DataFeed.Infrastructure.Providers.Fred.Models;

namespace DataFeed.Infrastructure.Providers.Fred
{
    public class FredApiProvider : ApiProviderBase, IFredApiProvider
    {
        private readonly string _apiKey;

        public FredApiProvider(IConfiguration config, HttpClient client) : base(client)
        {
            _apiKey = config["FredApi:Key"];
        }

        public async Task<FredSerieResponseModel?> GetSeriesAsync(string seriesId, CancellationToken cancellationToken)
        {
            var url = $"https://api.stlouisfed.org/fred/series?series_id={seriesId}&api_key={_apiKey}&file_type=json";
            var response = await _httpClient.GetAsync(url);

            response.EnsureSuccessStatusCode();

            var contentStream = await response.Content.ReadAsStreamAsync();
            return await JsonSerializer.DeserializeAsync<FredSerieResponseModel>(contentStream, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            });
        }

        public async Task<FredObservationResponseModel?> GetObservationsAsync(string observationId, DateTime? fromTime, DateTime? toTime, CancellationToken cancellationToken)
        {
            //observationId = "DGS1";
            //https://api.stlouisfed.org/fred/series/observations?series_id=DGS1&observation_start=2025-08-11&observation_end=2025-08-12&api_key=5c6ea88c2746a7ae71e7fb818417ee3e&file_type=json

            DateTime firstDayOfMonth = new DateTime(DateTime.Now.Year, 1, 1);
            string startObs = (fromTime ?? firstDayOfMonth).ToString("yyyy-MM-dd");
            string endObs = (toTime ?? DateTime.Now).ToString("yyyy-MM-dd");

            var url = $"https://api.stlouisfed.org/fred/series/observations?series_id={observationId}&observation_start={startObs}&observation_end={endObs}&api_key={_apiKey}&file_type=json";
            var response = await _httpClient.GetAsync(url);

            response.EnsureSuccessStatusCode();

            var contentStream = await response.Content.ReadAsStreamAsync();
            return await JsonSerializer.DeserializeAsync<FredObservationResponseModel>(contentStream, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            });
        }
    }
}