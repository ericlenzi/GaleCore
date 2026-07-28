using DataFeed.Application.App.GammaExposure;

namespace DataFeed.Tests;

/// <summary>
/// Regresión del bug de OI corrupto que envenenaba el netGEX agregado (netGEX = -1.2e17).
/// Congela la validación de Open Interest: un OI enorme / NaN / Infinity / negativo no debe
/// llegar crudo al cálculo de GEX, ni desbordar <c>(long)poi</c> a <c>long.MinValue</c>.
/// </summary>
public class GammaExposureOiTests
{
    [Theory]
    [InlineData("493", 493L)]
    [InlineData("200.0", 200L)]          // OI puede venir como decimal
    [InlineData("1", 1L)]
    [InlineData("1000000000", 1_000_000_000L)]  // tope plausible, inclusivo
    public void TryParseValidOpenInterest_AceptaValoresPlausibles(string raw, long expected)
    {
        Assert.True(GammaExposureHandler.TryParseValidOpenInterest(raw, out var oi));
        Assert.Equal(expected, oi);
    }

    [Theory]
    [InlineData("0")]
    [InlineData("-5")]
    [InlineData("1000000001")]            // apenas sobre el tope
    [InlineData("1e19")]                  // el caso real: double > long.MaxValue
    [InlineData("9999999999999999999")]   // idem, sin notación científica
    [InlineData("Infinity")]
    [InlineData("NaN")]
    [InlineData("abc")]
    [InlineData("")]
    [InlineData(null)]
    public void TryParseValidOpenInterest_RechazaValoresInvalidos(string? raw)
    {
        Assert.False(GammaExposureHandler.TryParseValidOpenInterest(raw, out var oi));
        Assert.Equal(0L, oi);   // nunca long.MinValue ni un residuo del cast
    }

    [Fact]
    public void TryParseValidOpenInterest_OiEnorme_NoDesbordaALongMinValue()
    {
        // Reproduce la causa raíz: un OI que como double supera long.MaxValue.
        // Antes del fix, (long)poi devolvía long.MinValue (-9.2e18) y envenenaba el netGEX.
        Assert.False(GammaExposureHandler.TryParseValidOpenInterest("1e19", out var oi));
        Assert.NotEqual(long.MinValue, oi);
        Assert.Equal(0L, oi);
    }

    [Theory]
    [InlineData(long.MinValue, 0L)]   // el sentinel que aparecía en putOI
    [InlineData(-1L, 0L)]
    [InlineData(0L, 0L)]
    [InlineData(100L, 100L)]
    [InlineData(long.MaxValue, long.MaxValue)]
    public void SanitizeOpenInterest_ClampeaNegativosACero(long input, long expected)
    {
        Assert.Equal(expected, GammaExposureHandler.SanitizeOpenInterest(input));
    }
}
