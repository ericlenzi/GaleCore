import React, { useState, useEffect } from 'react';
import './index.css';
import { LoginScreen } from './components/LoginScreen';
import { StatusBar } from './components/layout/StatusBar';
import { Sidebar } from './components/layout/Sidebar';
import { TabNav, Tab } from './components/layout/TabNav';
import { Home } from './pages/Home';
import { PortfolioManager } from './pages/PortfolioManager';
import { Monitor } from './pages/Monitor';
import { Strategy } from './pages/Strategy';
import { useMarketSocket, ConnectionStatus } from './socket/useMarketSocket';
import { useRulesStore } from './store/useRulesStore';
import { useAccountStore } from './store/useAccountStore';
import { fetchCoreRules } from './api/rules';
import { fetchBalances, fetchPositions } from './api/account';

function Dashboard() {
  const [tab, setTab] = useState<Tab>('inicio');
  const [socketStatus, setSocketStatus] = useState<ConnectionStatus>('disconnected');

  const { setRules, setLoading: setRulesLoading, setError: setRulesError, tickers } = useRulesStore();
  const { setBalances, setPositions, setLoadingBalances, setLoadingPositions, setErrorBalances, lastUpdate } = useAccountStore();

  useEffect(() => {
    // Rules
    setRulesLoading(true);
    fetchCoreRules()
      .then(setRules)
      .catch((e) => setRulesError(e.message ?? 'Error cargando reglas'))
      .finally(() => setRulesLoading(false));

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

  const { status, subscribeLeg, unsubscribeLeg } = useMarketSocket(tickers);
  useEffect(() => { setSocketStatus(status); }, [status]);

  return (
    <div className="flex" style={{ height: '100vh', backgroundColor: 'var(--bg-primary)' }}>
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <StatusBar connectionStatus={socketStatus} lastUpdate={lastUpdate} />
        <TabNav active={tab} onChange={setTab} />
        <main className="flex-1 overflow-auto" style={{ position: 'relative' }}>
          <div style={{ display: tab === 'inicio' ? 'block' : 'none', height: '100%', overflow: 'auto' }}><Home /></div>
          <div style={{ display: tab === 'portfolio' ? 'block' : 'none', height: '100%', overflow: 'auto' }}><PortfolioManager subscribeLeg={subscribeLeg} unsubscribeLeg={unsubscribeLeg} /></div>
          {tab === 'monitor'    && <Monitor />}
          {tab === 'estrategia' && <Strategy />}
        </main>
      </div>
    </div>
  );
}

function App() {
  const [authenticated, setAuthenticated] = useState<boolean>(
    () => !!sessionStorage.getItem('galecore:apiKey')
  );

  if (!authenticated) {
    return <LoginScreen onAuthenticated={() => setAuthenticated(true)} />;
  }

  return <Dashboard />;
}

export default App;
