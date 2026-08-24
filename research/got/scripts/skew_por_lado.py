# -*- coding: utf-8 -*-
"""
Mide cuanto paga cada lado de la cadena por unidad de delta, por simbolo.

Contesta la prediccion de la seccion 43.4: el sesgo put-only medido sobre TSLA,
es del modelo o de la superficie de TSLA?

La metrica es:

    (Credit / Width) / |delta del short leg|

`Credit/Width` es la perdida esperada risk-neutral como fraccion del ancho (43.2), y
`delta` es la probabilidad de terminar ITM. El cociente dice cuanto paga el mercado por
unidad de probabilidad. Si los dos lados dieran lo mismo, el filtro economico simetrico
seria neutral entre lados; la diferencia entre lados ES el sesgo.

Lo que mueve el cociente no es el NIVEL de IV sino su PENDIENTE entre los dos strikes,
porque el spread vende uno y compra el otro:

    put credit spread  -> vende el menos OTM, compra el mas OTM
    call credit spread -> vende el menos OTM, compra el mas OTM (del otro lado)

Con put skew (IV baja al subir el strike) la pendiente le RESTA credito al PCS y le SUMA
al CCS. Con el ala de call levantada, al reves.

Uso, desde la raiz del repo:

    PYTHONIOENCODING=utf-8 python research/got/scripts/skew_por_lado.py
"""
import csv
import os

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
WIDTH = 5.0
TARGETS = (0.10, 0.15, 0.20)

# spot / ATM IV / muros salen del encabezado que imprime gex-strikes.ps1 al capturar:
# no van al CSV. DTE tambien.
META = {
    ('TSLA', '2026-09-04'): dict(spot=355.10, dte=11, iv=0.417, cw=360.0, pw=345.0),
    ('TSLA', '2026-10-16'): dict(spot=356.70, dte=56, iv=0.427, cw=400.0, pw=330.0),
    ('SPY',  '2026-09-04'): dict(spot=763.28, dte=11, iv=0.1256, cw=778.0, pw=760.0),
    ('SPY',  '2026-10-16'): dict(spot=763.28, dte=53, iv=0.1370, cw=790.0, pw=730.0),
    ('QQQ',  '2026-09-04'): dict(spot=706.09, dte=11, iv=0.1984, cw=735.0, pw=700.0),
    ('QQQ',  '2026-10-16'): dict(spot=706.09, dte=53, iv=0.2035, cw=750.0, pw=700.0),
}


def load(sym, exp):
    p = os.path.join(BASE, '%s_gex_%s.csv' % (sym, exp))
    with open(p, encoding='utf-8-sig') as fh:
        rows = [{k: (float(v) if v else None) for k, v in r.items()}
                for r in csv.DictReader(fh)]
    return sorted(rows, key=lambda r: r['strike'])


def at_delta(rows, side, target):
    """Fila cuyo |delta| es el mas cercano al objetivo, con credito valido."""
    dk, ck = ('putDelta', 'pcsCredit_w5') if side == 'PUT' else ('callDelta', 'ccsCredit_w5')
    best = None
    for r in rows:
        if r[dk] is None or r[ck] is None or r[ck] <= 0:
            continue
        d = abs(r[dk])
        if not 0.03 < d < 0.45:
            continue
        gap = abs(d - target)
        if best is None or gap < best[0]:
            best = (gap, r['strike'], d, r[ck])
    return best[1:] if best else None


print('Cuanto paga cada lado por unidad de delta:  (Credit/Width) / |delta|')
print('Capturado 2026-08-24. TSLA en sesion (11:57 y 12:35 ET);')
print('SPY y QQQ post-cierre (17:2x ET) -- ver la nota del final.\n')

resumen = {}
for sym in ('SPY', 'QQQ', 'TSLA'):
    for exp in ('2026-09-04', '2026-10-16'):
        m = META[(sym, exp)]
        rows = load(sym, exp)
        print('%s  %s   DTE %-3d spot %.2f  IV %.3f' % (sym, exp, m['dte'], m['spot'], m['iv']))
        print('   %-6s %8s %8s %9s %9s %9s' % ('lado', 'delta', 'strike', 'credito', 'cred/w', 'ratio'))
        por_lado = {}
        for side in ('PUT', 'CALL'):
            vals = []
            for t in TARGETS:
                got = at_delta(rows, side, t)
                if not got:
                    continue
                k, d, c = got
                cw = c / WIDTH
                vals.append(cw / d)
                print('   %-6s %8.4f %8g %9.2f %9.4f %9.2f' % (side, d, k, c, cw, cw / d))
            if vals:
                por_lado[side] = sum(vals) / len(vals)
        if len(por_lado) == 2:
            sesgo = por_lado['CALL'] / por_lado['PUT']
            resumen.setdefault(sym, []).append(sesgo)
            print('   -> PUT %.2f   CALL %.2f   CALL/PUT = %.2f' %
                  (por_lado['PUT'], por_lado['CALL'], sesgo))
        print()

print('=' * 62)
print('SESGO POR SIMBOLO   (CALL/PUT del pago por unidad de delta)')
print('  > 1  el lado call paga mas -> el filtro economico sesga a CALL')
print('  < 1  el lado put  paga mas -> el filtro economico sesga a PUT')
print('=' * 62)
for sym, v in resumen.items():
    print('  %-6s %.2f      (por vencimiento: %s)' %
          (sym, sum(v) / len(v), '  '.join('%.2f' % x for x in v)))
