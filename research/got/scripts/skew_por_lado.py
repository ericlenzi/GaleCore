# -*- coding: utf-8 -*-
"""
Mide cuanto paga cada lado de la cadena por unidad de delta, por simbolo.

Contesta la pregunta de la seccion 43.4: el sesgo por lado, es del modelo o de la
superficie del simbolo con el que se midio?

La metrica es:

    (Credit / Width) / |delta del short leg|

`Credit/Width` es la perdida esperada risk-neutral como fraccion del ancho (43.2), y
`delta` es la probabilidad de terminar ITM. El cociente dice cuanto paga el mercado por
unidad de probabilidad. Si los dos lados dieran lo mismo, un umbral economico simetrico
seria neutral entre lados. La diferencia entre lados ES el sesgo.

Lo que mueve el cociente no es el NIVEL de IV sino su PENDIENTE entre los dos strikes,
porque el spread vende uno y compra el otro. Con put skew monotono la pendiente le RESTA
credito al put credit spread y le SUMA al call credit spread; con el ala de call
levantada, al reves.

Calcula todo dos veces: con el credito conservador que trae el CSV (bid del short contra
ask del long) y con MID. Si los dos coinciden, el ancho del book no explica el resultado.

No necesita spot, IV ni muros: le alcanzan las columnas de delta y credito del CSV.

Uso, desde la raiz del repo:

    PYTHONIOENCODING=utf-8 python research/got/scripts/skew_por_lado.py [carpeta]

`carpeta` es un subdirectorio de research/got/data/ (por defecto el mas reciente).
"""
import csv
import glob
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
WIDTH = 5.0
TARGETS = (0.10, 0.15, 0.20)


def carpeta_por_defecto():
    subs = [d for d in glob.glob(os.path.join(ROOT, '*')) if os.path.isdir(d)]
    if not subs:
        return ROOT
    return sorted(subs)[-1]


def load(path):
    with open(path, encoding='utf-8-sig') as fh:
        rows = [{k: (float(v) if v else None) for k, v in r.items()}
                for r in csv.DictReader(fh)]
    rows.sort(key=lambda r: r['strike'])
    return rows, {r['strike']: r for r in rows}


def mid(row, pre):
    b, a = row.get(pre + 'Bid'), row.get(pre + 'Ask')
    return (b + a) / 2 if b is not None and a is not None else None


def credito_mid(byk, strike, side):
    pre = 'put' if side == 'PUT' else 'call'
    corto = byk.get(strike)
    largo = byk.get(strike - WIDTH if side == 'PUT' else strike + WIDTH)
    if not corto or not largo:
        return None
    mc, ml = mid(corto, pre), mid(largo, pre)
    return None if mc is None or ml is None else mc - ml


def candidato(rows, side, target):
    """Fila con |delta| mas cercano al objetivo y credito valido."""
    dk = 'putDelta' if side == 'PUT' else 'callDelta'
    ck = 'pcsCredit_w5' if side == 'PUT' else 'ccsCredit_w5'
    mejor = None
    for r in rows:
        if r.get(dk) is None or r.get(ck) is None or r[ck] <= 0:
            continue
        d = abs(r[dk])
        if not 0.03 < d < 0.45:
            continue
        gap = abs(d - target)
        if mejor is None or gap < mejor[0]:
            mejor = (gap, r['strike'], d, r[ck])
    return mejor[1:] if mejor else None


def spread_medio(rows):
    vals = []
    for r in rows:
        for pre in ('call', 'put'):
            b, a = r.get(pre + 'Bid'), r.get(pre + 'Ask')
            if b and a and (a + b) > 0:
                v = (a - b) / ((a + b) / 2) * 100
                if v < 200:
                    vals.append(v)
    return sum(vals) / len(vals) if vals else None


def main():
    arg = sys.argv[1] if len(sys.argv) > 1 else None
    carpeta = os.path.join(ROOT, arg) if arg else carpeta_por_defecto()
    archivos = sorted(glob.glob(os.path.join(carpeta, '*_gex_*.csv')))
    if not archivos:
        print('Sin CSV en %s' % carpeta)
        return 1

    print('Cuanto paga cada lado por unidad de delta:  (Credit/Width) / |delta|')
    print('Captura: %s\n' % os.path.basename(os.path.normpath(carpeta)))
    print('%-6s %-11s | %-24s | %-24s | %s' %
          ('sim', 'vencimiento', 'bid-ask   PUT CALL ratio', 'mid       PUT CALL ratio', 'book'))
    print('-' * 96)

    resumen = {}
    for path in archivos:
        base = os.path.basename(path).replace('.csv', '')
        sym, exp = base.split('_gex_')
        rows, byk = load(path)
        lado = {}
        for side in ('PUT', 'CALL'):
            ba, md = [], []
            for t in TARGETS:
                got = candidato(rows, side, t)
                if not got:
                    continue
                k, d, c = got
                ba.append((c / WIDTH) / d)
                cm = credito_mid(byk, k, side)
                if cm and cm > 0:
                    md.append((cm / WIDTH) / d)
            if ba:
                lado[side] = (sum(ba) / len(ba), sum(md) / len(md) if md else None)
        if len(lado) < 2:
            print('%-6s %-11s | (sin candidatos de los dos lados)' % (sym, exp))
            continue
        rba = lado['CALL'][0] / lado['PUT'][0]
        rmd = (lado['CALL'][1] / lado['PUT'][1]
               if lado['PUT'][1] and lado['CALL'][1] else float('nan'))
        resumen.setdefault(sym, []).append((rba, rmd))
        print('%-6s %-11s | %5.2f %5.2f -> %-9.2f | %5.2f %5.2f -> %-9.2f | %.1f%%' %
              (sym, exp, lado['PUT'][0], lado['CALL'][0], rba,
               lado['PUT'][1] or 0, lado['CALL'][1] or 0, rmd, spread_medio(rows) or 0))

    print('\n' + '=' * 66)
    print('SESGO POR SIMBOLO   (CALL/PUT del pago por unidad de delta)')
    print('  > 1  el lado call paga mas -> el filtro economico sesga a CALL')
    print('  < 1  el lado put  paga mas -> el filtro economico sesga a PUT')
    print('=' * 66)
    for sym, v in sorted(resumen.items()):
        print('  %-6s bid-ask %.2f   mid %.2f' %
              (sym, sum(x[0] for x in v) / len(v), sum(x[1] for x in v) / len(v)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
