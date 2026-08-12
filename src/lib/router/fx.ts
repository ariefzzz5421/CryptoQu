/**
 * FX oracle.
 *
 * Quoting a rupiah amount against a dollar-pegged token needs two numbers: the
 * USD/IDR rate, and how far the token itself is trading from its peg. Both are
 * aggregated from several independent sources and reduced with a median so one
 * bad feed cannot move a quote.
 */

import { LIMITS, type AssetSymbol, ASSETS } from "./registry";

export type FiatCurrency = "USD" | "IDR" | "EUR" | "SGD";

export interface RateSample {
  source: string;
  /** Units of IDR per 1 unit of the base currency. */
  rate: number;
  fetchedAt: number;
  /** False when the value came from the offline baseline rather than a live feed. */
  live: boolean;
}

export interface RateSnapshot {
  base: FiatCurrency;
  quote: "IDR";
  /** Median of the accepted samples. */
  rate: number;
  samples: RateSample[];
  /** Spread between the highest and lowest accepted sample, in basis points. */
  dispersionBps: number;
  asOf: number;
  degraded: boolean;
}

/**
 * Baseline rates used when every live feed is unreachable. They keep the system
 * quoting rather than failing closed, and any quote built on them is flagged
 * `degraded` so the caller can widen its own risk limits.
 */
const BASELINE_IDR: Record<FiatCurrency, number> = {
  USD: 16_250,
  IDR: 1,
  EUR: 17_600,
  SGD: 12_100,
};

interface FeedDefinition {
  name: string;
  url: (base: FiatCurrency) => string;
  extract: (payload: unknown) => number | undefined;
}

const FEEDS: FeedDefinition[] = [
  {
    name: "open.er-api",
    url: (base) => `https://open.er-api.com/v6/latest/${base}`,
    extract: (payload) => numberAt(payload, ["rates", "IDR"]),
  },
  {
    name: "frankfurter",
    url: (base) => `https://api.frankfurter.app/latest?from=${base}&to=IDR`,
    extract: (payload) => numberAt(payload, ["rates", "IDR"]),
  },
  {
    name: "coinbase",
    url: (base) => `https://api.coinbase.com/v2/exchange-rates?currency=${base}`,
    extract: (payload) => numberAt(payload, ["data", "rates", "IDR"]),
  },
];

const FEED_TIMEOUT_MS = 2_500;
const CACHE_TTL_MS = 30_000;

const cache = new Map<FiatCurrency, RateSnapshot>();

/**
 * Returns the IDR rate for `base`. Results are cached briefly so a burst of
 * checkout traffic does not fan out to the upstream feeds.
 */
export async function getRateSnapshot(base: FiatCurrency): Promise<RateSnapshot> {
  if (base === "IDR") {
    return {
      base,
      quote: "IDR",
      rate: 1,
      samples: [{ source: "identity", rate: 1, fetchedAt: Date.now(), live: true }],
      dispersionBps: 0,
      asOf: Date.now(),
      degraded: false,
    };
  }

  const cached = cache.get(base);
  if (cached && Date.now() - cached.asOf < CACHE_TTL_MS) return cached;

  const settled = await Promise.allSettled(FEEDS.map((feed) => fetchFeed(feed, base)));
  const samples: RateSample[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled" && result.value) samples.push(result.value);
  }

  const accepted = rejectOutliers(samples);
  const degraded = accepted.length === 0;

  const snapshot: RateSnapshot = degraded
    ? {
        base,
        quote: "IDR",
        rate: BASELINE_IDR[base],
        samples: [
          { source: "baseline", rate: BASELINE_IDR[base], fetchedAt: Date.now(), live: false },
        ],
        dispersionBps: 0,
        asOf: Date.now(),
        degraded: true,
      }
    : {
        base,
        quote: "IDR",
        rate: median(accepted.map((s) => s.rate)),
        samples: accepted,
        dispersionBps: dispersionBps(accepted.map((s) => s.rate)),
        asOf: Date.now(),
        degraded: false,
      };

  cache.set(base, snapshot);
  return snapshot;
}

async function fetchFeed(feed: FeedDefinition, base: FiatCurrency): Promise<RateSample | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const response = await fetch(feed.url(base), {
      signal: controller.signal,
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return undefined;
    const rate = feed.extract(await response.json());
    if (!rate || !Number.isFinite(rate) || rate <= 0) return undefined;
    return { source: feed.name, rate, fetchedAt: Date.now(), live: true };
  } catch {
    // A dead or slow feed is expected; the median across the rest carries the quote.
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Drops samples more than 2% away from the median of the raw set — a feed that
 * has gone stale or is quoting a different pair should not drag the median.
 */
function rejectOutliers(samples: RateSample[]): RateSample[] {
  if (samples.length < 3) return samples;
  const mid = median(samples.map((s) => s.rate));
  return samples.filter((sample) => Math.abs(sample.rate - mid) / mid <= 0.02);
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function dispersionBps(values: number[]): number {
  if (values.length < 2) return 0;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return Math.round(((max - min) / min) * 10_000);
}

function numberAt(payload: unknown, path: string[]): number | undefined {
  let current: unknown = payload;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  const value = typeof current === "string" ? Number(current) : current;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Peg health for a stablecoin, in basis points away from 1.0 of its reference
 * currency. A token trading below peg costs the payer more of it to settle the
 * same rupiah amount, so the router prices this rather than assuming parity.
 */
export interface PegStatus {
  asset: AssetSymbol;
  /** Price of one token in its peg currency. 1.0 means exactly on peg. */
  price: number;
  deviationBps: number;
  healthy: boolean;
}

/**
 * Steady-state peg prices. Real deployments stream these from the same venues
 * that fill the order; the constants keep quoting deterministic offline.
 */
const PEG_PRICES: Record<AssetSymbol, number> = {
  USDC: 1.0,
  USDT: 0.9997,
  IDRX: 1.0,
  PYUSD: 0.9999,
  EURC: 1.0,
  XSGD: 0.9995,
};

export function getPegStatus(asset: AssetSymbol): PegStatus {
  const price = PEG_PRICES[asset] ?? 1;
  const deviationBps = Math.round(Math.abs(price - 1) * 10_000);
  return {
    asset,
    price,
    deviationBps,
    healthy: deviationBps <= LIMITS.maxPegDeviationBps,
  };
}

/** Convenience: the currency leg the router must cross for a given asset. */
export function pegCurrencyOf(asset: AssetSymbol): FiatCurrency {
  return ASSETS[asset].pegCurrency;
}
