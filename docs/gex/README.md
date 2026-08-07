# GEX — Gamma Exposure (informativa)

Documentación de la estrategia **GEX**, prefijo `Gex`. Estrategia **sin trades**: su único producto es
información de gamma exposure para que el operador decida.

## Contenido de esta carpeta

| Archivo | Rol |
|---|---|
| [`galecore-estrategia-gex.md`](galecore-estrategia-gex.md) | **Definición canónica.** Qué es, GEX global vs. de un vencimiento, capa 1 compartida, latencia y cache, umbral por símbolo, switch Workers, contrato de render. |
| [`gex_endpoint.md`](gex_endpoint.md) | Referencia del endpoint `/App.Analytics/GammaExposure` — el GEX de **un solo** vencimiento. Es el motor de cálculo sobre el que se apoya la estrategia, no la estrategia. |

## Fuente de verdad operativa

[`galecore_rules_gex.json`](../../source/galecore-datafeed/DataFeed.Api/Files/Gex/galecore_rules_gex.json)
— servido tal cual por `GET /App/Gex/Rules`. Ante discrepancia con los docs, manda el JSON.
Sus invariantes los congela `DataFeed.Tests/GexRulesJsonTests.cs`.
