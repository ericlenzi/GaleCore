import React from 'react';
import { LayoutDashboard, BarChart2, Activity, BookOpen } from 'lucide-react';

export type Tab = 'inicio' | 'portfolio' | 'monitor' | 'estrategia';

interface Props {
  active: Tab;
  onChange: (tab: Tab) => void;
}

const TABS: { id: Tab; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'inicio',     label: 'Inicio',            Icon: LayoutDashboard },
  { id: 'portfolio',  label: 'Portfolio Manager',  Icon: BarChart2       },
  { id: 'monitor',    label: 'Monitor',            Icon: Activity        },
  { id: 'estrategia', label: 'Estrategia',         Icon: BookOpen        },
];

export function TabNav({ active, onChange }: Props) {
  return (
    <nav
      className="flex items-center shrink-0"
      style={{
        backgroundColor: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border-dark)',
        paddingLeft: 8,
        height: 36,
      }}
    >
      {TABS.map(({ id, label, Icon }) => {
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
    </nav>
  );
}
