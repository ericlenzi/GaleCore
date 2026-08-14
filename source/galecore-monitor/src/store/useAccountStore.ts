import { create } from 'zustand';
import { BalancesResponse, PositionResponse } from '../types/api';

/**
 * Balances y posiciones de la cuenta de bróker del operador.
 *
 * ES DE LA PERSONA LOGUEADA, no de la plataforma: por eso lo limpia `resetUserScopedStores()` al
 * cerrar sesión, y por eso un error PISA los datos en vez de dejarlos al lado del cartel rojo.
 * Números viejos abajo de un error se leen como vigentes: un operador recién dado de alta, cuyo
 * `Balances` devuelve 500 porque todavía no vinculó su cuenta, veía el número de cuenta y las
 * posiciones del que había usado el tablero antes que él.
 */
interface AccountStore {
  balances: BalancesResponse | null;
  positions: PositionResponse[];
  loadingBalances: boolean;
  loadingPositions: boolean;
  errorBalances: string | null;
  lastUpdate: Date | null;
  setBalances: (b: BalancesResponse) => void;
  setPositions: (p: PositionResponse[]) => void;
  setLoadingBalances: (v: boolean) => void;
  setLoadingPositions: (v: boolean) => void;
  /** El error deja la cuenta en blanco: sin dato es mejor que con el dato de otro. */
  setErrorBalances: (e: string | null) => void;
  /** Las posiciones no se pudieron leer: se vacían por el mismo motivo. */
  failPositions: () => void;
  /** Vuelve al estado inicial. La llama `resetUserScopedStores()`. */
  reset: () => void;
}

const EMPTY = {
  balances: null,
  positions: [] as PositionResponse[],
  loadingBalances: false,
  loadingPositions: false,
  errorBalances: null,
  lastUpdate: null,
};

export const useAccountStore = create<AccountStore>((set) => ({
  ...EMPTY,

  setBalances: (b) => set({ balances: b, lastUpdate: new Date(), errorBalances: null }),
  setPositions: (p) => set({ positions: p }),
  setLoadingBalances: (v) => set({ loadingBalances: v }),
  setLoadingPositions: (v) => set({ loadingPositions: v }),
  setErrorBalances: (e) => set(e ? { errorBalances: e, balances: null, lastUpdate: null } : { errorBalances: null }),
  failPositions: () => set({ positions: [] }),

  reset: () => set({ ...EMPTY }),
}));
