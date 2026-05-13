import React, { useState } from 'react';
import { useRulesStore } from '../../store/useRulesStore';
import { ManualPosition, PositionType, SuggestedSetup } from '../../types/position';
import { calcDte } from '../../utils/formatters';

interface Props {
  onAdd: (p: ManualPosition) => void;
  onCancel: () => void;
  prefill?: SuggestedSetup & { symbol: string };
}

const TYPES: PositionType[] = ['PUT_CS', 'CALL_CS', 'IC', 'LONG'];
const TYPE_LABELS: Record<PositionType, string> = {
  PUT_CS: 'PUT CS', CALL_CS: 'CALL CS', IC: 'IC', LONG: 'LONG',
};

const inputStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg-tertiary)',
  border:          '1px solid var(--border-dark)',
  color:           'var(--text-primary)',
  borderRadius:    4,
  padding:         '4px 8px',
  fontSize:        12,
  fontFamily:      'JetBrains Mono, monospace',
  width:           '100%',
  outline:         'none',
};

const labelStyle: React.CSSProperties = {
  color:          'var(--text-muted)',
  fontSize:       10,
  textTransform:  'uppercase',
  letterSpacing:  '0.05em',
  display:        'block',
  marginBottom:   2,
};

export function NewPositionForm({ onAdd, onCancel, prefill }: Props) {
  const { tickers } = useRulesStore();

  const [symbol,      setSymbol]      = useState(prefill?.symbol ?? tickers[0] ?? '');
  const [type,        setType]        = useState<PositionType>(prefill?.type ?? 'PUT_CS');
  const [shortStrike, setShortStrike] = useState(String(prefill?.shortStrike ?? ''));
  const [longStrike,  setLongStrike]  = useState(String(prefill?.longStrike  ?? ''));
  const [shortStrike2, setShortStrike2] = useState(String(prefill?.secondShortStrike ?? ''));
  const [longStrike2,  setLongStrike2]  = useState(String(prefill?.secondLongStrike  ?? ''));
  const [expiration,  setExpiration]  = useState(prefill?.expiration ?? '');
  const [credit,      setCredit]      = useState('');
  const [contracts,   setContracts]   = useState('1');
  const [note,        setNote]        = useState('');
  const [error,       setError]       = useState<string | null>(null);

  const isIC = type === 'IC';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!symbol || !expiration || !credit || !shortStrike || !longStrike) {
      setError('Completá todos los campos obligatorios.');
      return;
    }
    if (isIC && (!shortStrike2 || !longStrike2)) {
      setError('IC requiere los cuatro strikes.');
      return;
    }

    const dte = calcDte(expiration);
    if (dte < 0) { setError('La expiración ya venció.'); return; }

    const position: ManualPosition = {
      id:          crypto.randomUUID(),
      symbol,
      type,
      shortStrike: parseFloat(shortStrike),
      longStrike:  parseFloat(longStrike),
      ...(isIC && { shortStrike2: parseFloat(shortStrike2), longStrike2: parseFloat(longStrike2) }),
      expiration,
      credit:    parseFloat(credit),
      contracts: parseInt(contracts, 10) || 1,
      openDate:  new Date().toISOString().slice(0, 10),
      note:      note.trim() || undefined,
    };
    onAdd(position);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="p-4 rounded"
      style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-dark)' }}
    >
      <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>
        {prefill ? 'Confirmar Posición' : 'Nueva Posición'}
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}>
        <div>
          <label style={labelStyle}>Ticker</label>
          <select value={symbol} onChange={(e) => setSymbol(e.target.value)} style={inputStyle}>
            {tickers.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div>
          <label style={labelStyle}>Tipo</label>
          <select value={type} onChange={(e) => setType(e.target.value as PositionType)} style={inputStyle}>
            {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
          </select>
        </div>

        <div>
          <label style={labelStyle}>{isIC ? 'Put Short' : 'Strike Short'}</label>
          <input type="number" step="0.5" value={shortStrike} onChange={(e) => setShortStrike(e.target.value)} style={inputStyle} placeholder="0" />
        </div>

        <div>
          <label style={labelStyle}>{isIC ? 'Put Long' : 'Strike Long'}</label>
          <input type="number" step="0.5" value={longStrike} onChange={(e) => setLongStrike(e.target.value)} style={inputStyle} placeholder="0" />
        </div>

        {isIC && (
          <>
            <div>
              <label style={labelStyle}>Call Short</label>
              <input type="number" step="0.5" value={shortStrike2} onChange={(e) => setShortStrike2(e.target.value)} style={inputStyle} placeholder="0" />
            </div>
            <div>
              <label style={labelStyle}>Call Long</label>
              <input type="number" step="0.5" value={longStrike2} onChange={(e) => setLongStrike2(e.target.value)} style={inputStyle} placeholder="0" />
            </div>
          </>
        )}

        <div>
          <label style={labelStyle}>Expiración</label>
          <input type="date" value={expiration} onChange={(e) => setExpiration(e.target.value)} style={inputStyle} />
        </div>

        <div>
          <label style={labelStyle}>Crédito ($)</label>
          <input type="number" step="0.01" value={credit} onChange={(e) => setCredit(e.target.value)} style={inputStyle} placeholder="0.00" />
        </div>

        <div>
          <label style={labelStyle}>Contratos</label>
          <input type="number" min="1" step="1" value={contracts} onChange={(e) => setContracts(e.target.value)} style={inputStyle} />
        </div>

        <div style={{ gridColumn: 'span 2' }}>
          <label style={labelStyle}>Nota (opcional)</label>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} style={inputStyle} placeholder="…" />
        </div>
      </div>

      {error && <div className="mt-2 text-xs" style={{ color: 'var(--red-gc)' }}>{error}</div>}

      <div className="flex gap-2 mt-3">
        <button
          type="submit"
          className="px-4 py-1.5 rounded text-xs font-semibold"
          style={{ backgroundColor: 'var(--blue-gc)', color: '#fff', border: 'none', cursor: 'pointer' }}
        >
          Registrar
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-1.5 rounded text-xs"
          style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)', border: '1px solid var(--border-dark)', cursor: 'pointer' }}
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
