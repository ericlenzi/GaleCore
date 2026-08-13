import React, { useState, useEffect } from 'react';
import './index.css';
import { LoginScreen } from './components/LoginScreen';
import { supabase, getSession, signOut } from './auth/supabase';
import { StatusBar } from './components/layout/StatusBar';
import { Sidebar } from './components/layout/Sidebar';
import { TabNav, Tab } from './components/layout/TabNav';
import { Home } from './pages/Home';
import { Admin } from './pages/Admin';
import { Monitor } from './pages/Monitor';
import { Rpf } from './pages/Rpf';
import { Gex } from './pages/Gex';
import { useMarketSocket, ConnectionStatus } from './socket/useMarketSocket';
import { useAppConfigStore } from './store/useAppConfigStore';
import { useAccountStore } from './store/useAccountStore';
import { useCurrentUserStore } from './store/useCurrentUserStore';
import { fetchAppConfig } from './api/rules';
import { fetchBalances, fetchPositions } from './api/account';

interface DashboardProps {
  onLogout: () => void;
}

function Dashboard({ onLogout }: DashboardProps) {
  const [tab, setTab] = useState<Tab>('inicio');
  const [socketStatus, setSocketStatus] = useState<ConnectionStatus>('disconnected');

  const { setConfig, setLoading: setConfigLoading, setError: setConfigError, tickers } = useAppConfigStore();
  const { setBalances, setPositions, setLoadingBalances, setLoadingPositions, setErrorBalances, lastUpdate } = useAccountStore();
  const loadCurrentUser = useCurrentUserStore((s) => s.load);

  useEffect(() => {
    // Quién está logueado y qué le deja hacer la plataforma. Va primero porque de acá sale si los
    // switches se muestran habilitados: sin esto, un no-admin clickearía para cobrar un 403.
    loadCurrentUser();

    // Config de la app (universo, estrategias, monitor)
    setConfigLoading(true);
    fetchAppConfig()
      .then(setConfig)
      .catch((e) => setConfigError(e.message ?? 'Error cargando la configuración'))
      .finally(() => setConfigLoading(false));

    // Balances
    setLoadingBalances(true);
    fetchBalances()
      .then(setBalances)
      .catch((e) => setErrorBalances(e.message ?? 'Error cargando balances'))
      .finally(() => setLoadingBalances(false));

    // Positions
    setLoadingPositions(true);
    fetchPositions()
      .then(setPositions)
      .catch(() => {})
      .finally(() => setLoadingPositions(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { status, subscribeSymbol, unsubscribeSymbol, subscribeLeg, unsubscribeLeg, acceptSuggestion, dismissSuggestion } = useMarketSocket(tickers);
  useEffect(() => { setSocketStatus(status); }, [status]);

  return (
    <div className="flex" style={{ height: '100vh', backgroundColor: 'var(--bg-primary)' }}>
      <Sidebar onLogoClick={() => setTab('inicio')} />
      <div className="flex flex-col flex-1 min-w-0">
        <StatusBar connectionStatus={socketStatus} lastUpdate={lastUpdate} />
        <TabNav active={tab} onChange={setTab} onLogout={onLogout} />
        <main className="flex-1 overflow-auto" style={{ position: 'relative' }}>
          <div style={{ display: tab === 'inicio' ? 'block' : 'none', height: '100%', overflow: 'auto' }}>
            <Home onNavigate={(t) => setTab(t as Tab)} />
          </div>
          <div style={{ display: tab === 'monitor' ? 'block' : 'none', height: '100%', overflow: 'auto' }}>
            <Monitor subscribeLeg={subscribeLeg} unsubscribeLeg={unsubscribeLeg}
              subscribeSymbol={subscribeSymbol} unsubscribeSymbol={unsubscribeSymbol} socketStatus={socketStatus} />
          </div>
          <div style={{ display: tab === 'rpf' ? 'block' : 'none', height: '100%', overflow: 'auto' }}>
            <Rpf acceptSuggestion={acceptSuggestion} dismissSuggestion={dismissSuggestion}
              subscribeLeg={subscribeLeg} unsubscribeLeg={unsubscribeLeg} socketStatus={socketStatus} />
          </div>
          {/* Admin se monta recién al entrar: lee la cuenta de bróker y, si sos admin, la lista de
              usuarios — nada de eso tiene sentido traerlo en cada arranque del tablero. */}
          {tab === 'admin' && <Admin />}
          {/* GEX se monta recién al entrar: el barrido de la cadena completa es caro y no tiene
              sentido dispararlo si el operador nunca abre la pestaña. */}
          {tab === 'gex' && <Gex subscribeSymbol={subscribeSymbol} unsubscribeSymbol={unsubscribeSymbol} socketStatus={socketStatus} />}
        </main>
      </div>
    </div>
  );
}

function App() {
  // null = todavía no sabemos. La sesión de Supabase vive en localStorage y leerla es asincrónico,
  // así que hay un instante inicial sin respuesta. Sin este tercer estado, ese instante se
  // renderizaría como "no autenticado" y mostraría el login por un parpadeo a quien YA tiene sesión.
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;

    getSession().then((session) => {
      if (alive) setAuthenticated(!!session);
    });

    // Mantiene el tablero en sincronía con la sesión real: cierre desde otra pestaña, token que no
    // se pudo renovar, logout. Sin esto, una sesión vencida dejaría la UI montada pidiendo datos
    // que la API ya rechaza.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (alive) setAuthenticated(!!session);
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const handleLogout = async () => {
    await signOut();
    sessionStorage.removeItem('galecore:apiKey');
    setAuthenticated(false);
  };

  if (authenticated === null) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: 'var(--bg-primary)' }}
      >
        <span className="spinner" style={{ width: 20, height: 20 }} />
      </div>
    );
  }

  if (!authenticated) {
    return <LoginScreen onAuthenticated={() => setAuthenticated(true)} />;
  }

  return <Dashboard onLogout={handleLogout} />;
}

export default App;
