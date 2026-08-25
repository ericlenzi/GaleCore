# -*- coding: utf-8 -*-
"""
El muro de gamma como BANDA en vez de argmax, y si esa banda sirve para algo.

La 61.4 encontro que `SelectCallWall` es un argmax sobre un solo strike y que eso no
alcanza para ser una referencia: nunca concentra mas del 19% del GEX del lado, la
dominancia contra el segundo candidato baja a 1.0x, y el muro salta. Pidio un umbral de
dominancia. Este script prueba OTRA salida al mismo problema: que el muro sea la ventana
de strikes mas densa, no el strike mas alto.

Corre las mediciones del hallazgo 2026-08-25 sobre la banda, en ese orden:

  0. EL BORDE POR EM -- correlacion de rango entre `distancia/EM` y el delta, que es lo que
                     decide si la segunda condicion de la 61.3 aporta algo.
  1. ESTABILIDAD  -- la banda contra el argmax, en las tandas que haya de cada vencimiento.
  2. RESTRICCION  -- el borde externo de la banda contra un corte de delta 0.20: la
                     estructura, empuja mas afuera de lo que ya empujaba el delta?
  3. PREMIO       -- cuanto mas paga vender en el borde de la banda, Y el control de si
                     ese pago sobrevive a descontar el delta.

Mas una cuarta, de sanidad: la sensibilidad de la banda al ancho elegido.

DEFINICIONES

`EM*` -- proxy de 1 sigma computable desde cualquier captura: la distancia del spot al
strike de delta 0.1587, promediada entre lados. NO es el Expected Move de la 15
(`spot * atmIv * sqrt(dte/365)`): en SPY 16-Oct da 42.9 contra 39.0, un 10% mas, porque
absorbe el smile y la brecha d1/d2. Se usa aca porque el CSV no trae ni el ATM IV ni el
DTE -- el encabezado del script de captura los imprime y no los escribe -- y porque las
capturas del 2026-08-24 son anteriores a las columnas de IV. Como solo fija el ANCHO de
la banda, la diferencia de escala no cambia ninguna conclusion (ver seccion 4).

`spot` -- se interpola del strike de callDelta 0.5, por la misma razon.

`banda` -- la ventana de ancho `FRAC_EM * EM*` que maximiza la suma de |GEX| del lado. Su
borde EXTERNO (el mas lejos del spot) es el que define la zona vendible.

`xmed`  -- la banda contra la ventana MEDIANA del mismo lado. Mide si hay concentracion o
           si la "banda mas densa" es una banda cualquiera.
`xdisj` -- la banda contra la mejor ventana DISJUNTA. Mide si el muro es uno o son dos.

Los dos tests hacen falta: TSLA 09-18 CALL da xmed 8.6x y xdisj 1.01x -- muy concentrado,
pero en dos lugares distintos, o sea que no hay UN muro.

`eficiencia` -- `(credito / width) / |delta del short|`. Es la metrica de skew_por_lado.py:
cuanto paga el mercado por unidad de probabilidad. Se usa aca para el control del premio.

EL CONTROL, QUE ES EL PUNTO DE LA SECCION 3

Vender en el borde de la banda paga mas que vender delta 0.15, pero el borde ESTA a delta
mas alto, asi que tiene que pagar mas. La pregunta es si paga mas de lo que le corresponde
por su delta. Se ajusta `eficiencia ~ a + b*d + c*d^2` con los strikes LEJOS de la banda y
se mide el residuo del borde en unidades de la desviacion de ese ajuste. Si el muro tuviera
un premio propio, el borde caeria sistematicamente por encima de la curva.

Es el control que este research fallo tres veces: WD contra delta (43.2), `d_min x EM`
contra delta (61.3), y `RequiredCredit` como gate economico (43.2). Las tres veces la
respuesta fue "eso es delta".

Uso, desde la raiz del repo:

    PYTHONIOENCODING=utf-8 python research/got/scripts/banda_de_gamma.py [carpeta]

`carpeta` es un subdirectorio de research/got/data/ para las secciones 2-4 (por defecto
2026-08-25, la unica con los tres simbolos en sesion). La seccion 1 recorre todas.
"""
import csv
import glob
import os
import statistics
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
WIDTH = 5.0          # el width del vertical que trae el CSV
FRAC_EM = 0.25       # ancho de la banda, en EM*
DELTA_REF = 0.20     # el corte de delta contra el que se mide si la estructura restringe
DELTA_CMP = 0.15     # el delta contra el que se compara el credito del borde
SIGMA_1 = 0.1587     # N(-1): el strike de este delta esta a ~1 sigma


# ---------------------------------------------------------------- lectura

def num(row, col):
    v = row.get(col, '')
    return float(v) if v not in ('', None) else None


def interpolar_strike(pts, objetivo):
    """pts = [(strike, delta)] ordenado por strike. Strike donde delta = objetivo."""
    for i in range(len(pts) - 1):
        (k1, d1), (k2, d2) = pts[i], pts[i + 1]
        if (d1 - objetivo) * (d2 - objetivo) <= 0 and d1 != d2:
            return k1 + (objetivo - d1) * (k2 - k1) / (d2 - d1)
    return None


def contexto(rows):
    """spot y EM* interpolados de la curva de delta. Ver DEFINICIONES."""
    call = sorted([(num(r, 'strike'), num(r, 'callDelta')) for r in rows
                   if num(r, 'strike') is not None and num(r, 'callDelta') is not None])
    put = sorted([(num(r, 'strike'), abs(num(r, 'putDelta') or 0)) for r in rows
                  if num(r, 'strike') is not None and num(r, 'putDelta') is not None])
    spot = interpolar_strike(call, 0.5)
    kc = interpolar_strike(call, SIGMA_1)
    kp = interpolar_strike(put, SIGMA_1)
    if spot is None or kc is None or kp is None:
        return None, None, call, put
    return spot, statistics.mean([kc - spot, spot - kp]), call, put


def gex_del_lado(rows, spot, lado):
    col = 'putGEX_musd' if lado == 'PUT' else 'callGEX_musd'
    c = [(num(r, 'strike'), abs(num(r, col) or 0)) for r in rows if num(r, 'strike') is not None]
    return [x for x in c if ((x[0] < spot) if lado == 'PUT' else (x[0] > spot)) and x[1] > 0]


def delta_en(tabla, strike):
    return min(tabla, key=lambda x: abs(x[0] - strike))[1]


# ---------------------------------------------------------------- la banda

def medir(rows, spot, em, lado, frac=FRAC_EM):
    c = gex_del_lado(rows, spot, lado)
    if len(c) < 6:
        return None
    total = sum(x[1] for x in c)
    ancho = frac * em

    ventanas = []
    for k0, _ in c:
        lo, hi = (k0, k0 + ancho) if lado == 'CALL' else (k0 - ancho, k0)
        ventanas.append((sum(x[1] for x in c if lo <= x[0] <= hi), lo, hi))
    ventanas.sort(key=lambda x: -x[0])
    mejor = ventanas[0]
    mediana = statistics.median(v[0] for v in ventanas)
    disjunta = next((v for v in ventanas if v[2] <= mejor[1] or v[1] >= mejor[2]), None)

    orden = sorted(c, key=lambda x: -x[1])
    return dict(
        argmax=orden[0][0],
        dom=orden[0][1] / orden[1][1] if len(orden) > 1 else float('inf'),
        lo=mejor[1], hi=mejor[2],
        borde=mejor[2] if lado == 'CALL' else mejor[1],
        pct=mejor[0] / total * 100,
        xmed=mejor[0] / mediana if mediana else 0.0,
        xdisj=mejor[0] / disjunta[0] if disjunta and disjunta[0] else float('inf'),
        em=em, spot=spot,
    )


def vendibles(rows, lado):
    """(strike, |delta|, credito) de los strikes con quote viva y credito valido."""
    dcol, ccol, bcol = ('putDelta', 'pcsCredit_w5', 'putBid') if lado == 'PUT' \
                       else ('callDelta', 'ccsCredit_w5', 'callBid')
    out = []
    for r in rows:
        k, d, c, b = num(r, 'strike'), num(r, dcol), num(r, ccol), num(r, bcol)
        if None in (k, d, c, b) or c <= 0 or b <= 0:
            continue
        out.append((k, abs(d), c))
    return out


def ajuste_cuadratico(xs, ys):
    n = len(xs)
    S = [sum(x ** p for x in xs) for p in range(5)]
    T = [sum(ys[i] * xs[i] ** p for i in range(n)) for p in range(3)]
    A = [[S[0], S[1], S[2]], [S[1], S[2], S[3]], [S[2], S[3], S[4]]]
    b = T[:]
    for i in range(3):
        p = max(range(i, 3), key=lambda r: abs(A[r][i]))
        A[i], A[p] = A[p], A[i]
        b[i], b[p] = b[p], b[i]
        for r in range(i + 1, 3):
            m = A[r][i] / A[i][i]
            for col in range(i, 3):
                A[r][col] -= m * A[i][col]
            b[r] -= m * b[i]
    x = [0.0, 0.0, 0.0]
    for i in (2, 1, 0):
        x[i] = (b[i] - sum(A[i][col] * x[col] for col in range(i + 1, 3))) / A[i][i]
    return x


# ---------------------------------------------------------------- recorrido

def capturas():
    subs = sorted(d for d in glob.glob(os.path.join(ROOT, '*')) if os.path.isdir(d))
    return [d for d in subs if glob.glob(os.path.join(d, '*_gex_*.csv'))]


def casos(carpeta):
    for path in sorted(glob.glob(os.path.join(carpeta, '*_gex_*.csv'))):
        nombre = os.path.basename(path)[:-4]
        sym, _, exp = nombre.split('_')
        rows = list(csv.DictReader(open(path, encoding='utf-8-sig')))
        spot, em, call, put = contexto(rows)
        if spot is None:
            continue
        yield sym, exp, rows, spot, em, call, put


# ---------------------------------------------------------------- secciones

def rangos(xs):
    orden = sorted(range(len(xs)), key=lambda i: xs[i])
    r = [0.0] * len(xs)
    i = 0
    while i < len(orden):
        j = i
        while j + 1 < len(orden) and xs[orden[j + 1]] == xs[orden[i]]:
            j += 1
        for k in range(i, j + 1):
            r[orden[k]] = (i + j) / 2.0 + 1
        i = j + 1
    return r


def spearman(a, b):
    ra, rb = rangos(a), rangos(b)
    n = len(a)
    ma, mb = sum(ra) / n, sum(rb) / n
    num_ = sum((ra[i] - ma) * (rb[i] - mb) for i in range(n))
    da = sum((x - ma) ** 2 for x in ra) ** 0.5
    db = sum((x - mb) ** 2 for x in rb) ** 0.5
    return num_ / (da * db) if da and db else float('nan')


def seccion_0_borde_por_em(carpeta):
    """La 61.3 pone dos condiciones sobre el mismo eje: pasar el muro Y separarse `d_min x EM`.

    La segunda no es una condicion estructural. Dentro de UN vencimiento, `distancia/EM` es
    una transformacion afin del strike -- EM es una constante -- y el delta es monotono en
    el strike. Las dos ordenan la cadena igual, al revés. Un corte en `d_min x EM` ES un
    corte de delta, y no puede aportar informacion que el delta no tenga.

    Esto se mide, no se argumenta: rho de Spearman entre las dos, por caso.
    """
    print('\n' + '=' * 100)
    print(f'0. EL BORDE POR EM -- rho(distancia/EM, |delta|)   [{os.path.basename(carpeta)}]')
    print('=' * 100)
    print(f'  {"caso":>17} | {"n":>4} {"rho":>8}')
    for sym, exp, rows, spot, em, call, put in casos(carpeta):
        for lado in ('PUT', 'CALL'):
            v = [(k, d) for k, d, _ in vendibles(rows, lado) if 0 < d < 1]
            v = [(k, d) for k, d in v if ((k < spot) if lado == 'PUT' else (k > spot))]
            if len(v) < 8:
                continue
            # distancia/EM crece alejandose del spot: -strike del lado put, +strike del call
            dist = [(spot - k) / em if lado == 'PUT' else (k - spot) / em for k, _ in v]
            print(f'  {sym + " " + exp[5:] + " " + lado:>17} | {len(v):4d} '
                  f'{spearman(dist, [d for _, d in v]):+8.4f}')
    print('\n  rho = -1 exacto significa que las dos variables ordenan la cadena identico: el')
    print('  borde por `d_min x EM` de la 61.3 es un corte de delta escrito de otra manera.')


def seccion_1_estabilidad():
    print('\n' + '=' * 100)
    print('1. ESTABILIDAD -- la banda contra el argmax, misma serie en tandas distintas')
    print('=' * 100)
    serie = {}
    for carpeta in capturas():
        tanda = os.path.basename(carpeta)
        for sym, exp, rows, spot, em, call, put in casos(carpeta):
            for lado in ('PUT', 'CALL'):
                m = medir(rows, spot, em, lado)
                if m:
                    serie.setdefault((sym, exp, lado), []).append((tanda, m))
    for clave in sorted(serie):
        tandas = serie[clave]
        if len(tandas) < 2:
            continue
        print(f'\n  {clave[0]} {clave[1]} {clave[2]}')
        print(f'    {"tanda":>14} | {"argmax":>7} {"dom":>6} | {"banda":>15} {"%lado":>6} '
              f'{"xmed":>6} {"xdisj":>6} | {"borde":>7}')
        for tanda, m in tandas:
            print(f'    {tanda:>14} | {m["argmax"]:7.0f} {m["dom"]:5.2f}x | '
                  f'{m["lo"]:7.1f}-{m["hi"]:<7.1f} {m["pct"]:5.1f}% {m["xmed"]:5.1f}x '
                  f'{m["xdisj"]:5.2f}x | {m["borde"]:7.1f}')


def seccion_2_restriccion(carpeta):
    print('\n' + '=' * 100)
    print(f'2. RESTRICCION -- borde de la banda contra un corte de delta {DELTA_REF:.2f}'
          f'   [{os.path.basename(carpeta)}]')
    print('=' * 100)
    print(f'  {"caso":>17} | {"borde":>7} {"delta":>6} {"xmed":>6} {"xdisj":>6} | ata?')
    for sym, exp, rows, spot, em, call, put in casos(carpeta):
        for lado in ('PUT', 'CALL'):
            m = medir(rows, spot, em, lado)
            if not m:
                continue
            tabla = put if lado == 'PUT' else call
            d = delta_en(tabla, m['borde'])
            ata = 'SI' if d < DELTA_REF else 'no'
            print(f'  {sym + " " + exp[5:] + " " + lado:>17} | {m["borde"]:7.1f} {d:6.3f} '
                  f'{m["xmed"]:5.1f}x {m["xdisj"]:5.2f}x | {ata}')


def seccion_3_premio(carpeta):
    print('\n' + '=' * 100)
    print(f'3. PREMIO -- credito en el borde contra delta {DELTA_CMP:.2f}, y el control'
          f'   [{os.path.basename(carpeta)}]')
    print('=' * 100)
    print(f'  {"caso":>17} | {"K":>6} {"dlt":>5} {"cred":>6} | {"K":>6} {"dlt":>5} {"cred":>6} '
          f'| {"x cred":>7} | {"ef obs":>7} {"ef fit":>7} {"z":>6}')
    zs = []
    for sym, exp, rows, spot, em, call, put in casos(carpeta):
        for lado in ('PUT', 'CALL'):
            m = medir(rows, spot, em, lado)
            if not m:
                continue
            venta = vendibles(rows, lado)
            if len(venta) < 12:
                continue
            cand = [x for x in venta if (x[0] <= m['borde'] if lado == 'PUT' else x[0] >= m['borde'])]
            if not cand:
                continue
            a = min(cand, key=lambda x: abs(x[0] - m['borde']))
            b = min(venta, key=lambda x: abs(x[1] - DELTA_CMP))
            etiqueta = f'{sym} {exp[5:]} {lado}'
            if a[0] == b[0]:
                print(f'  {etiqueta:>17} | mismo strike ({a[0]:.0f}): el borde cae donde ya vendia '
                      f'delta {DELTA_CMP:.2f}')
                continue

            # control: ef ~ f(delta) ajustado SIN los strikes de la banda
            pts = [(k, d, (c / WIDTH) / d) for k, d, c in venta if 0.05 <= d <= 0.45]
            fuera = [x for x in pts if not (m['lo'] - em * 0.1 <= x[0] <= m['hi'] + em * 0.1)]
            fit_txt = z_txt = '     --'
            if len(fuera) >= 8:
                coef = ajuste_cuadratico([x[1] for x in fuera], [x[2] for x in fuera])
                fit = lambda d: coef[0] + coef[1] * d + coef[2] * d * d
                sd = statistics.pstdev([x[2] - fit(x[1]) for x in fuera]) or 1e-9
                ef = (a[2] / WIDTH) / a[1]
                z = (ef - fit(a[1])) / sd
                zs.append(z)
                fit_txt = f'{ef:7.3f} {fit(a[1]):7.3f}'
                z_txt = f'{z:+6.2f}'
                print(f'  {etiqueta:>17} | {a[0]:6.0f} {a[1]:5.3f} {a[2]:6.2f} | '
                      f'{b[0]:6.0f} {b[1]:5.3f} {b[2]:6.2f} | {a[2] / b[2]:6.2f}x | {fit_txt} {z_txt}')
    if zs:
        media = statistics.mean(zs)
        err = statistics.pstdev(zs) / (len(zs) ** 0.5)
        print(f'\n  z medio {media:+.2f} +/- {err:.2f} sobre {len(zs)} casos '
              f'({sum(1 for z in zs if z > 0)} positivos, {sum(1 for z in zs if z <= 0)} negativos)')
        print('  Un z medio indistinguible de cero = el borde de la banda NO paga por encima de lo')
        print('  que le corresponde por su delta: el premio de credito es delta, no estructura.')


def seccion_4_sensibilidad(carpeta):
    print('\n' + '=' * 100)
    print(f'4. SENSIBILIDAD -- el borde segun el ancho de banda   [{os.path.basename(carpeta)}]')
    print('=' * 100)
    fracs = (0.15, 0.20, 0.25, 0.30, 0.40)
    print(f'  {"caso":>17} | ' + ' '.join(f'{f"{fr:.2f} EM*":>9}' for fr in fracs) +
          f' | {"rango delta":>13} {"xdisj":>7}')
    for sym, exp, rows, spot, em, call, put in casos(carpeta):
        for lado in ('PUT', 'CALL'):
            base = medir(rows, spot, em, lado)
            if not base:
                continue
            tabla = put if lado == 'PUT' else call
            bordes, deltas = [], []
            for fr in fracs:
                m = medir(rows, spot, em, lado, fr)
                bordes.append(m['borde'])
                deltas.append(delta_en(tabla, m['borde']))
            print(f'  {sym + " " + exp[5:] + " " + lado:>17} | ' +
                  ' '.join(f'{b:9.1f}' for b in bordes) +
                  f' | {min(deltas):.3f}-{max(deltas):.3f} {base["xdisj"]:6.2f}x')
    print('\n  El borde externo se corre con el ancho por construccion (la banda crece hacia afuera).')
    print('  Lo que importa es si la banda se MUDA de lugar: eso pasa en QQQ 10-16 PUT y TSLA 09-18')
    print('  CALL, y las dos estaban marcadas por xdisj ~ 1.0x.')


def main():
    pedida = sys.argv[1] if len(sys.argv) > 1 else '2026-08-25'
    carpeta = os.path.join(ROOT, pedida)
    if not os.path.isdir(carpeta):
        print(f'no existe {carpeta}')
        return 1
    seccion_0_borde_por_em(carpeta)
    seccion_1_estabilidad()
    seccion_2_restriccion(carpeta)
    seccion_3_premio(carpeta)
    seccion_4_sensibilidad(carpeta)
    return 0


if __name__ == '__main__':
    sys.exit(main())
