import { create } from 'zustand';
import { CurrentUser, fetchCurrentUser } from '../api/me';

/**
 * Quién está logueado y qué le deja hacer la plataforma.
 *
 * Existe para que el tablero no muestre habilitado lo que la API va a rechazar: el switch de una
 * estrategia es global y admin-only, así que a un no-admin hay que mostrárselo deshabilitado en vez
 * de dejarlo clickear para cobrar un 403.
 *
 * Se lee UNA vez al montar el tablero. No hay refresh: el rol de un usuario no cambia mientras usa
 * la app, y si cambia, vuelve a entrar.
 */
interface CurrentUserStore {
  user: CurrentUser | null;
  /** null = todavía no se sabe. No es lo mismo que "no puede": mientras carga no se decide nada. */
  loaded: boolean;
  load: () => Promise<void>;
}

export const useCurrentUserStore = create<CurrentUserStore>((set, get) => ({
  user: null,
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    try {
      set({ user: await fetchCurrentUser(), loaded: true });
    } catch {
      // Sin respuesta no se asume permiso: el botón queda deshabilitado y la API sigue siendo la
      // que decide. Fallar hacia "no puede" es lo correcto para un permiso.
      set({ user: null, loaded: true });
    }
  },
}));

/**
 * ¿Puede tocar los kill switch? `null` mientras no se sepa, para que la UI pueda distinguir
 * "cargando" de "no puede" y no parpadee un botón deshabilitado a quien sí es admin.
 */
export const useCanManagePlatform = (): boolean | null =>
  useCurrentUserStore((s) => (s.loaded ? (s.user?.canManagePlatform ?? false) : null));
