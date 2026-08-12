namespace DataFeed.Repositories.Entities
{
    /// <summary>
    /// Cuenta de bróker de un usuario.
    ///
    /// NO guarda el client_secret: ese es de la APLICACIÓN OAuth registrada, no del usuario — se
    /// genera al crear la app y se regenera desde el perfil de Tastytrade sin que cambie el
    /// client_id. Va en configuración; duplicarlo por fila sería esparcir un secreto de aplicación
    /// en N lugares. Lo que sí es por usuario es el refresh token.
    /// </summary>
    public class Account
    {
        public Guid Id { get; set; }

        public Guid UserId { get; set; }
        public User? User { get; set; }

        /// <summary>
        /// Hoy siempre "tastytrade". Existe desde el día uno porque el sub-prefijo por cuenta ya
        /// está previsto en la taxonomía de la API para cuando se sume un segundo bróker.
        /// </summary>
        public string Broker { get; set; } = "tastytrade";

        public string AccountNumber { get; set; } = "";

        /// <summary>
        /// Refresh token de OAuth del usuario, CIFRADO. El nombre lleva el sufijo a propósito: es un
        /// token de una cuenta de bróker real y guardarlo en claro convierte un leak de la base en
        /// un leak de dinero ajeno. Quien escriba acá tiene que cifrar; quien lea, descifrar.
        /// </summary>
        public string RefreshTokenEncrypted { get; set; } = "";

        /// <summary>
        /// Marca la cuenta que usan los procesos de fondo para pedir DATOS DE MERCADO (el ingestor,
        /// RpfLoopService, SkewSnapshotService). Esos corren en un timer, sin
        /// request y sin usuario logueado, así que necesitan una credencial que no sea de nadie en
        /// particular.
        ///
        /// Es la mitad "mercado compartido" de la división del doc de arquitectura: SPY es SPY para
        /// todos, así que se pide UNA vez con esta cuenta. Los datos de CUENTA (posiciones, balances)
        /// nunca pasan por acá: van siempre con la credencial del usuario que pregunta.
        ///
        /// Un índice único parcial garantiza que haya como máximo una.
        /// </summary>
        public bool IsSystem { get; set; }

        public DateTime CreatedAt { get; set; }
        public DateTime UpdatedAt { get; set; }
    }
}
