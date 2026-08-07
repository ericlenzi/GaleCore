import React, { useState, useEffect } from 'react';
import './index.css';
import { LoginScreen } from './components/LoginScreen';
import { StatusBar } from './components/layout/StatusBar';
import { Sidebar } from './components/layout/Sidebar';
import { TabNav, Tab } from './components/layout/TabNav';
import { Home } from './pages/Home';
import { Monitor } from './pages/Monitor';
import { Rpf } from './pages/Rpf';
import { Gex } from './pages/Gex';
import { useMarketSocket, ConnectionStatus } from './socket/useMarketSocket';
import { useAppConfigStore } from './store/useAppConfigStore';
import { useAccountStore } from './store/useAccountStore';
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

  useEffect(() => {
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

  const { status, subscribeLeg, unsubscribeLeg, acceptSuggestion, dismissSuggestion } = useMarketSocket(tickers);
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
            <Monitor subscribeLeg={subscribeLeg} unsubscribeLeg={unsubscribeLeg} socketStatus={socketStatus} />
          </div>
          <div style={{ display: tab === 'rpf' ? 'block' : 'none', height: '100%', overflow: 'auto' }}>
            <Rpf acceptSuggestion={acceptSuggestion} dismissSuggestion={dismissSuggestion}
              subscribeLeg={subscribeLeg} unsubscribeLeg={unsubscribeLeg} socketStatus={socketStatus} />
          </div>
          {/* GEX se monta recién al entrar: el barrido de la cadena completa es caro y no tiene
              sentido dispararlo si el operador nunca abre la pestaña. */}
          {tab === 'gex' && <Gex />}
        </main>
      </div>
    </div>
  );
}

function App() {
  const [authenticated, setAuthenticated] = useState<boolean>(
    () => !!sessionStorage.getItem('galecore:apiKey')
  );

  const handleLogout = () => {
    sessionStorage.removeItem('galecore:apiKey');
    setAuthenticated(false);
  };

  if (!authenticated) {
    return <LoginScreen onAuthenticated={() => setAuthenticated(true)} />;
  }

  return <Dashboard onLogout={handleLogout} />;
}

export default App;
