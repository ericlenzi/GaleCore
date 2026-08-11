namespace DataFeed.Api.Controllers.Dtos
{
    /// <summary>
    /// Vincula la cuenta de bróker del usuario autenticado.
    ///
    /// NO lleva client_secret: ese es de la aplicación OAuth registrada y vive en configuración.
    /// Lo que es por usuario es el refresh token, y se guarda cifrado.
    /// </summary>
    public class LinkBrokerAccountRequest
    {
        /// <summary>Número de cuenta en Tastytrade (ej. 5WZ50196).</summary>
        public string AccountNumber { get; set; } = "";

        /// <summary>Refresh token OAuth del usuario. Se cifra antes de tocar la base.</summary>
        public string RefreshToken { get; set; } = "";
    }
}
