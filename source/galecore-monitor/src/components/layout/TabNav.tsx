import React from 'react';
import { LayoutDashboard, Activity, Zap, BarChart3, LogOut, Shield } from 'lucide-react';

// Los ids de las pestañas de estrategia ('rpf', 'gex') son los que declara `tab` en strategies[]
// del config de la app: las cards de Main navegan por ese valor.
export type Tab = 'inicio' | 'monitor' | 'rpf' | 'gex' | 'admin';

interface Props {
  active: Tab;
  onChange: (tab: Tab) => void;
  onLogout?: () => void;
  /** Muestra la pestaña Administrator. Es cosmético: el gate real es el 403 del endpoint. */
  showAdmin?: boolean;
}

// References dejó de ser pestaña: cada estrategia tiene su botón "References" en la cabecera de su
// pantalla, que abre un modal con Definiciones + JSON de reglas.
const TABS: { id: Tab; label: string; Icon: React.ComponentType<{ size?: number }>; adminOnly?: boolean }[] = [
  { id: 'inicio',          label: 'Main',              Icon: LayoutDashboard },
  { id: 'monitor',         label: 'Monitor',           Icon: Activity        },
  { id: 'gex',             label: 'GEX',               Icon: BarChart3       },
  { id: 'rpf',             label: 'RPF',               Icon: Zap             },
  { id: 'admin',           label: 'Admin',             Icon: Shield, adminOnly: true },
];

export function TabNav({ active, onChange, onLogout, showAdmin }: Props) {
  const tabs = TABS.filter((t) => !t.adminOnly || showAdmin);

  return (
    <nav
      className="flex items-center shrink-0"
      style={{
        backgroundColor: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border-dark)',
        paddingLeft: 8,
        paddingRight: 12,
        height: 36,
      }}
    >
      {tabs.map(({ id, label, Icon }) => {
        const isActive = id === active;
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            className="flex items-center gap-1.5 px-4 h-full text-xs uppercase tracking-wider transition-colors relative"
            style={{
              color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'Inter, sans-serif',
              fontWeight: isActive ? 600 : 400,
              borderBottom: isActive ? '2px solid var(--blue-gc)' : '2px solid transparent',
              whiteSpace: 'nowrap',
            }}
          >
            <Icon size={12} />
            {label}
          </button>
        );
      })}
      {onLogout && (
        <button
          onClick={onLogout}
          className="flex items-center gap-1.5 ml-auto text-xs uppercase tracking-wider"
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontFamily: 'Inter, sans-serif',
            fontWeight: 400,
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
        >
          <LogOut size={12} />
          LOGOUT
        </button>
      )}
    </nav>
  );
}
