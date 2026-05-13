export function fmtPrice(n: number, decimals = 2): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function fmtCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

export function fmtPct(n: number, decimals = 2): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(decimals)}%`;
}

export function fmtGex(billions: number): string {
  if (Math.abs(billions) >= 1000) return `$${(billions / 1000).toFixed(1)}T`;
  return `$${billions.toFixed(0)}B`;
}

export function fmtTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function isStale(date: Date | null, thresholdMs = 60000): boolean {
  if (!date) return true;
  return Date.now() - date.getTime() > thresholdMs;
}

export function calcChange(price: number, open: number): { abs: number; pct: number } {
  if (!open) return { abs: 0, pct: 0 };
  const abs = price - open;
  const pct = (abs / open) * 100;
  return { abs, pct };
}

export function calcDte(expiration: string): number {
  const exp = new Date(expiration + 'T00:00:00');
  const now = new Date();
  const diff = exp.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

/** Returns ET market status using UTC-based DST approximation (works regardless of local timezone) */
export function getMarketStatus(): 'PRE-MARKET' | 'ABIERTO' | 'CERRADO' {
  const now = new Date();
  // EDT (UTC-4): second Sunday of March through first Sunday of November
  // Approximate with month range: March(3) through November(11) exclusive
  const month = now.getUTCMonth() + 1; // 1-12
  const etOffsetHours = (month >= 3 && month <= 11) ? 4 : 5; // hours behind UTC
  const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60;
  const etHours = ((utcHours - etOffsetHours) % 24 + 24) % 24;

  if (etHours >= 9.5 && etHours < 16) return 'ABIERTO';
  if (etHours >= 4   && etHours < 9.5) return 'PRE-MARKET';
  return 'CERRADO';
}

export function signalColor(signal: string): string {
  if (signal === 'OPERAR') return '#00c896';
  if (signal === 'ESPERAR') return '#f59e0b';
  return '#ef4444';
}

export function boolToStatus(v: boolean | null): 'ok' | 'warn' | 'na' {
  if (v === null) return 'na';
  return v ? 'ok' : 'warn';
}
