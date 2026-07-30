using DataFeed.Application.App.Rpf.Engine;
using Xunit;

namespace DataFeed.Tests;

/// <summary>
/// Congela el cortocircuito de la cascada del motor RPF autónomo (RpfCascadeResolver): qué capa reporta
/// el corte (FailedAtLayer) y qué veredicto propaga (OverallSignal). Espeja la semántica de la cascada
/// de Main que RPF antes heredaba vía ValidationLayer — el corte a motor propio no debe cambiarla.
/// </summary>
public class RpfCascadeResolverTests
{
    [Fact]
    public void MacroNoOpera_CortaEnCapa1()
    {
        // Aun con todo lo demás en OPERAR, si macro no pasa el corte es en capa 1.
        var (overall, failed) = RpfCascadeResolver.Resolve("NO_OPERAR", "OPERAR", "OPERAR", "OPERAR", true);
        Assert.Equal("NO_OPERAR", overall);
        Assert.Equal(1, failed);
    }

    [Fact]
    public void MacroEspera_SePropagaComoVeredictoPeroNoFrena()
    {
        // ESPERAR (macro 5/6) no corta en capa 1; si strike falla, corta en 2 propagando ESPERAR.
        var (overall, failed) = RpfCascadeResolver.Resolve("ESPERAR", "NO_OPERAR", "OPERAR", "OPERAR", false);
        Assert.Equal("ESPERAR", overall);
        Assert.Equal(2, failed);
    }

    [Fact]
    public void MacroOpera_StrikeFalla_CortaEnCapa2NoOpera()
    {
        var (overall, failed) = RpfCascadeResolver.Resolve("OPERAR", "NO_OPERAR", "OPERAR", "OPERAR", false);
        Assert.Equal("NO_OPERAR", overall);
        Assert.Equal(2, failed);
    }

    [Fact]
    public void MicroFalla_CortaEnCapa3()
    {
        var (_, failed) = RpfCascadeResolver.Resolve("OPERAR", "OPERAR", "NO_OPERAR", "OPERAR", false);
        Assert.Equal(3, failed);
    }

    [Fact]
    public void SizingFalla_CortaEnCapa4()
    {
        var (_, failed) = RpfCascadeResolver.Resolve("OPERAR", "OPERAR", "OPERAR", "NO_OPERAR", false);
        Assert.Equal(4, failed);
    }

    [Fact]
    public void TodoPasa_GatesFallan_CortaEnCapa2()
    {
        // Los signal_gates son parte del embudo del strike-engine → capa 2.
        var (overall, failed) = RpfCascadeResolver.Resolve("OPERAR", "OPERAR", "OPERAR", "OPERAR", gatesAllPass: false);
        Assert.Equal("NO_OPERAR", overall);
        Assert.Equal(2, failed);
    }

    [Fact]
    public void TodoPasa_GatesPasan_Opera()
    {
        var (overall, failed) = RpfCascadeResolver.Resolve("OPERAR", "OPERAR", "OPERAR", "OPERAR", gatesAllPass: true);
        Assert.Equal("OPERAR", overall);
        Assert.Null(failed);
    }

    [Fact]
    public void TodoPasa_GatesPasan_ConMacroEspera_PropagaEspera()
    {
        // Macro ESPERAR que llega hasta el final con gates OK: el veredicto es ESPERAR, sin capa de corte.
        var (overall, failed) = RpfCascadeResolver.Resolve("ESPERAR", "OPERAR", "OPERAR", "OPERAR", gatesAllPass: true);
        Assert.Equal("ESPERAR", overall);
        Assert.Null(failed);
    }
}
