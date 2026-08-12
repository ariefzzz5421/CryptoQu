"use client";

import { useCallback, useEffect, useState } from "react";

import { formatRate, relativeTime } from "@/lib/format";

interface Health {
  status: string;
  version: string;
  components: Record<string, string>;
  fx: { usdIdr: number; sources: string[]; dispersionBps: number; asOf: string };
  counters: { merchants: number; intents: number; ledgerTransactions: number };
  trialBalance: Record<string, string>;
}

interface Rates {
  rates: {
    base: string;
    rate: number;
    degraded: boolean;
    dispersionBps: number;
    asOf: string;
    sources: { name: string; rate: number; live: boolean }[];
  }[];
  pegs: { asset: string; price: number; deviationBps: number; healthy: boolean }[];
}

export function StatusBoard() {
  const [health, setHealth] = useState<Health | null>(null);
  const [rates, setRates] = useState<Rates | null>(null);
  const [checkedAt, setCheckedAt] = useState<number>(Date.now());

  const refresh = useCallback(async () => {
    const load = async <T,>(url: string): Promise<T | null> => {
      try {
        const response = await fetch(url, { cache: "no-store" });
        return (await response.json()) as T;
      } catch {
        return null;
      }
    };
    const [healthData, ratesData] = await Promise.all([
      load<Health>("/api/v1/health"),
      load<Rates>("/api/v1/rates"),
    ]);
    if (healthData) setHealth(healthData);
    if (ratesData) setRates(ratesData);
    setCheckedAt(Date.now());
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(refresh, 20_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const overall = health?.status ?? "checking";

  return (
    <div className="space-y-8">
      <div className="panel flex flex-wrap items-center justify-between gap-4 p-6">
        <div className="flex items-center gap-3">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              overall === "ok"
                ? "bg-[var(--color-mint-400)]"
                : overall === "degraded"
                  ? "bg-[var(--color-amber-warn)]"
                  : "bg-[var(--color-mist-600)]"
            }`}
          />
          <div>
            <p className="text-lg font-semibold">
              {overall === "ok"
                ? "All systems operational"
                : overall === "degraded"
                  ? "Operating in degraded mode"
                  : "Checking…"}
            </p>
            <p className="num text-xs text-[var(--color-mist-600)]">
              v{health?.version ?? "—"} · checked {relativeTime(checkedAt)}
            </p>
          </div>
        </div>
        <button type="button" className="btn btn-ghost" onClick={refresh}>
          Refresh
        </button>
      </div>

      <section>
        <h2 className="eyebrow mb-4">Components</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {Object.entries(health?.components ?? { ledger: "…", fxOracle: "…", routing: "…" }).map(
            ([name, state]) => (
              <div key={name} className="panel-flat p-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">{humanise(name)}</p>
                  <span className={`badge ${state === "ok" ? "badge-mint" : state === "degraded" ? "badge-warn" : ""}`}>
                    {state}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-[var(--color-mist-600)]">
                  {DESCRIPTIONS[name] ?? ""}
                </p>
              </div>
            ),
          )}
        </div>
      </section>

      <section>
        <h2 className="eyebrow mb-4">FX oracle</h2>
        <div className="panel scroll-x">
          <table className="table">
            <thead>
              <tr>
                <th>Pair</th>
                <th className="text-right">Median</th>
                <th className="text-right">Dispersion</th>
                <th>Sources</th>
                <th className="text-right">Age</th>
              </tr>
            </thead>
            <tbody>
              {(rates?.rates ?? []).map((rate) => (
                <tr key={rate.base}>
                  <td className="num text-[var(--color-mist-100)]">{rate.base}/IDR</td>
                  <td className="num text-right">{formatRate(rate.rate)}</td>
                  <td className="num text-right text-[var(--color-mist-600)]">
                    {rate.dispersionBps} bps
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1.5">
                      {rate.sources.map((source) => (
                        <span
                          key={source.name}
                          className={`badge ${source.live ? "badge-mint" : "badge-warn"}`}
                        >
                          {source.name}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="num text-right text-[var(--color-mist-600)]">
                    {relativeTime(rate.asOf)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rates?.rates.some((rate) => rate.degraded) && (
          <p className="mt-3 text-xs text-[var(--color-amber-warn)]">
            One or more live feeds are unreachable, so quoting is running on the offline baseline.
            Quotes built this way are flagged degraded rather than silently priced.
          </p>
        )}
      </section>

      <section>
        <h2 className="eyebrow mb-4">Peg health</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(rates?.pegs ?? []).map((peg) => (
            <div key={peg.asset} className="panel-flat flex items-center justify-between p-4">
              <div>
                <p className="num text-sm text-[var(--color-mist-100)]">{peg.asset}</p>
                <p className="num text-[11px] text-[var(--color-mist-600)]">
                  {peg.price.toFixed(4)} · {peg.deviationBps} bps off peg
                </p>
              </div>
              <span className={`badge ${peg.healthy ? "badge-mint" : "badge-bad"}`}>
                {peg.healthy ? "healthy" : "halted"}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="eyebrow mb-4">Books</h2>
        <div className="panel p-6">
          <div className="flex flex-wrap gap-2">
            {Object.entries(health?.trialBalance ?? {}).map(([currency, total]) => (
              <span key={currency} className={`badge ${total === "0" ? "badge-mint" : "badge-bad"}`}>
                {currency} {total}
              </span>
            ))}
          </div>
          <p className="mt-4 text-xs leading-relaxed text-[var(--color-mist-600)]">
            Every currency must sum to zero across all accounts. {health?.counters.ledgerTransactions ?? 0}{" "}
            transactions posted · {health?.counters.intents ?? 0} intents ·{" "}
            {health?.counters.merchants ?? 0} merchants.
          </p>
        </div>
      </section>
    </div>
  );
}

const DESCRIPTIONS: Record<string, string> = {
  ledger: "Double-entry books. Degraded means a trial balance is non-zero.",
  fxOracle: "Independent rate feeds, reduced by median. Degraded means the offline baseline is in use.",
  routing: "Route planning across assets, chains, venues and payout rails.",
};

function humanise(name: string): string {
  return name.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}
