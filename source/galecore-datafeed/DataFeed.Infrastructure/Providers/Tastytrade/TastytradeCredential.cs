using System.Threading;
using System.Threading.Tasks;

namespace DataFeed.Infrastructure.Providers.Tastytrade
{
    /// <summary>
    /// Credencial con la que se le habla a Tastytrade. El <see cref="RefreshToken"/> es POR USUARIO;
    /// el client_secret NO está acá porque es de la aplicación OAuth registrada y vive en
    /// configuración (se regenera desde el perfil de Tastytrade sin que cambie el client_id).
    /// </summary>
    /// <param name="Id">
    /// Clave de cache de los access token. Es el id de la fila de `accounts`, o "config" cuando la
    /// credencial sale de appsettings. Dos credenciales distintas NO pueden compartir cache: el
    /// access token de una no sirve para la cuenta de la otra.
    /// </param>
    /// <param name="Source">"db" o "config" — para que el log diga de dónde salió.</param>
    public sealed record TastytradeCredential(
        string Id,
        string RefreshToken,
        string? AccountNumber,
        string Source);

    /// <summary>
    /// De dónde salen las credenciales. Implementa la división del doc de arquitectura §5.4:
    /// los datos de MERCADO usan una credencial de sistema (SPY es SPY para todos) y los de CUENTA
    /// la del usuario que pregunta (las posiciones no son de todos).
    /// </summary>
    public interface ITastytradeCredentialStore
    {
        /// <summary>
        /// Credencial para datos de mercado. Sale de la cuenta marcada `is_system`; si no hay base
        /// configurada o no hay ninguna marcada, cae a appsettings — que es exactamente lo que la
        /// plataforma hacía antes de existir la base.
        ///
        /// La usan los procesos de fondo (el loop de RPF, el barrido de la cadena, los snapshots de
        /// skew, el flow): corren en un timer, sin request y sin usuario logueado, así que no tienen
        /// de quién tomar una credencial.
        /// </summary>
        Task<TastytradeCredential> GetSystemAsync(CancellationToken ct = default);

        /// <summary>
        /// Credencial de un usuario para pedir SUS datos de cuenta. null si el usuario no tiene
        /// cuenta de bróker vinculada — el llamador decide si eso es 404 o "todavía no vinculaste".
        /// </summary>
        Task<TastytradeCredential?> GetForUserAsync(Guid userId, CancellationToken ct = default);
    }

    /// <summary>
    /// Cifra y descifra los refresh token antes de que toquen la base. Son credenciales de cuentas
    /// de bróker reales: guardarlas en claro convierte un leak de la base en un leak de dinero ajeno.
    /// </summary>
    public interface ITokenProtector
    {
        string Protect(string plaintext);
        string Unprotect(string ciphertext);
    }
}
