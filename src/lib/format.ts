/** Display helpers shared by every surface. Formatting lives in one place so a
 * rupiah amount looks identical in the checkout, the dashboard and the docs. */

export function formatIdr(amount: number, options: { compact?: boolean } = {}): string {
  if (!Number.isFinite(amount)) return "—";
  if (options.compact && Math.abs(amount) >= 1_000_000) {
    return `Rp${(amount / 1_000_000).toFixed(1)}jt`;
  }
  if (options.compact && Math.abs(amount) >= 1_000) {
    return `Rp${(amount / 1_000).toFixed(0)}rb`;
  }
  return `Rp${Math.round(amount).toLocaleString("id-ID")}`;
}

/** Token amounts keep full precision — a payer needs the exact figure to send. */
export function formatToken(amount: number, symbol: string, decimals = 6): string {
  if (!Number.isFinite(amount)) return "—";
  const trimmed = amount.toFixed(decimals).replace(/\.?0+$/, "");
  return `${trimmed} ${symbol}`;
}

export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

export function formatRate(rate: number): string {
  if (!Number.isFinite(rate)) return "—";
  if (rate >= 1000) return rate.toLocaleString("id-ID", { maximumFractionDigits: 0 });
  return rate.toLocaleString("id-ID", { maximumFractionDigits: 4 });
}

export function shortHash(value: string, lead = 8, tail = 6): string {
  if (value.length <= lead + tail + 1) return value;
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

export function relativeTime(iso: string | number): string {
  const time = typeof iso === "number" ? iso : Date.parse(iso);
  const delta = Math.round((Date.now() - time) / 1000);
  if (!Number.isFinite(delta)) return "—";
  if (delta < 5) return "just now";
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}
