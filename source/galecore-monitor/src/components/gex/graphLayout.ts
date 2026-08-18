/**
 * Los dos anchos fijos de la fila Graph de la pestaña GEX, juntos porque uno se define en función
 * del otro. En el medio, el gráfico de velas se queda con lo que sobra.
 *
 * Separados en dos archivos eran dos números sueltos que nadie relacionaba, y la proporción se
 * perdía en el primer retoque de cualquiera de los dos.
 */

/** Columna izquierda: lista de vencimientos + Expiry Engine. Es una lista, no necesita más. */
export const CHAIN_COL_W = 230;

/** Panel de barras de GEX por strike: el DOBLE de la columna izquierda. Es el gráfico que se lee. */
export const GEX_BARS_W = CHAIN_COL_W * 2;
