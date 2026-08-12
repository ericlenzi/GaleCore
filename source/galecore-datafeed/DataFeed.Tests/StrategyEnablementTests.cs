using DataFeed.Application.App.Shared;

namespace DataFeed.Tests;

/// <summary>
/// Congela la tabla de verdad del switch de estrategia, que tiene tres niveles (reglas, plataforma,
/// usuario). Es una función pura a propósito: la regla que decide si una estrategia opera se puede
/// verificar sin base, sin disco y sin levantar la API.
///
/// Lo que estos tests protegen no es la aritmética booleana sino DOS invariantes de seguridad:
///   * la plataforma gana cuando apaga — un usuario no puede prender lo que el operador cortó;
///   * un nivel ausente hereda del de arriba, nunca prende por su cuenta.
/// </summary>
public class StrategyEnablementTests
{
    [Fact]
    public void Sin_overrides_manda_el_json_de_reglas()
    {
        Assert.Equal((true, "rules"), StrategyEnablement.Resolve(rules: true, platform: null, user: null));
        Assert.Equal((false, "rules"), StrategyEnablement.Resolve(rules: false, platform: null, user: null));
    }

    [Fact]
    public void El_override_de_plataforma_pisa_al_json_de_reglas()
    {
        Assert.Equal((false, "platform"), StrategyEnablement.Resolve(rules: true, platform: false, user: null));
        Assert.Equal((true, "platform"), StrategyEnablement.Resolve(rules: false, platform: true, user: null));
    }

    [Fact]
    public void El_usuario_decide_mientras_la_plataforma_este_prendida()
    {
        Assert.Equal((false, "user"), StrategyEnablement.Resolve(rules: true, platform: true, user: false));
        Assert.Equal((true, "user"), StrategyEnablement.Resolve(rules: true, platform: null, user: true));
        Assert.Equal((true, "user"), StrategyEnablement.Resolve(rules: false, platform: true, user: true));
    }

    /// <summary>
    /// El invariante del kill switch: con la plataforma en OFF, ningún usuario puede prender la
    /// estrategia desde su tablero. Si esto se rompe, el operador pierde la única palanca que corta
    /// el consumo de feed y la emisión para todos.
    /// </summary>
    [Theory]
    [InlineData(true, null)]
    [InlineData(true, true)]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public void La_plataforma_apagada_no_la_prende_nadie(bool rules, bool? user)
    {
        var (enabled, source) = StrategyEnablement.Resolve(rules, platform: false, user: user);

        Assert.False(enabled);
        Assert.Equal("platform", source);
    }

    /// <summary>
    /// Con las reglas en OFF y sin overrides, la estrategia está apagada aunque el usuario nunca
    /// haya tocado nada: la fila ausente hereda, no prende.
    /// </summary>
    [Fact]
    public void La_fila_ausente_hereda_en_vez_de_prender()
    {
        var (enabled, source) = StrategyEnablement.Resolve(rules: false, platform: null, user: null);

        Assert.False(enabled);
        Assert.Equal("rules", source);
    }
}
