import { create } from 'zustand';
import { BalancesResponse, PositionResponse } from '../types/api';
import type { AccountFailure } from '../api/account';

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
  /**
   * El operador no vinculó su cuenta de bróker. Es distinto de un error cualquiera: no hay nada
   * roto, le falta un paso. El Monitor lo usa para mostrar su cartel en vez de una pantalla vacía.
   */
  brokerAccountMissing: boolean;
  lastUpdate: Date | null;
  setBalances: (b: BalancesResponse) => void;
  setPositions: (p: PositionResponse[]) => void;
  setLoadingBalances: (v: boolean) => void;
  setLoadingPositions: (v: boolean) => void;
  /** El error deja la cuenta en blanco: sin dato es mejor que con el dato de otro. */
  setErrorBalances: (f: AccountFailure | null) => void;
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
  brokerAccountMissing: false,
  lastUpdate: null,
};

export const useAccountStore = create<AccountStore>((set) => ({
  ...EMPTY,

  // Que los balances lleguen prueba que la cuenta está vinculada: se limpia la marca.
  setBalances: (b) => set({ balances: b, lastUpdate: new Date(), errorBalances: null, brokerAccountMissing: false }),
  setPositions: (p) => set({ positions: p }),
  setLoadingBalances: (v) => set({ loadingBalances: v }),
  setLoadingPositions: (v) => set({ loadingPositions: v }),
  setErrorBalances: (f) => set(f
    ? { errorBalances: f.message, brokerAccountMissing: f.brokerAccountMissing, balances: null, lastUpdate: null }
    : { errorBalances: null, brokerAccountMissing: false }),
  failPositions: () => set({ positions: [] }),

  reset: () => set({ ...EMPTY }),
}));
