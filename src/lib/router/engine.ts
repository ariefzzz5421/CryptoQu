/**
 * The payment router.
 *
 * Given a rupiah amount a merchant must receive, it enumerates every way that
 * amount can be sourced — asset, chain, liquidity venue, IDR payout rail —
 * prices each one end to end, and ranks them under a chosen objective.
 *
 * The router never mutates state. It takes a rate snapshot and a set of
 * constraints and returns priced routes; committing to one is the quote
 * layer's job.
 */

import {
  ASSETS,
  CHAINS,
  LIMITS,
  PLATFORM_FEE_BPS,
  SETTLEMENT_RAILS,
  VENUES,
  type AssetSymbol,
  type ChainId,
  type SettlementRail,
  type Venue,
} from "./registry";
import { getPegStatus, type FiatCurrency, type PegStatus, type RateSnapshot } from "./fx";

export type Objective = "cost" | "speed" | "balanced";

export interface RouteRequest {
  /** Rupiah the merchant must receive, inclusive of any convenience fee. */
  amountIdr: number;
  /** Restrict to these assets. Defaults to everything CryptoQu accepts. */
  assets?: AssetSymbol[];
  /** Restrict to these chains. Defaults to everything. */
  chains?: ChainId[];
  objective?: Objective;
  /** Reject routes slower than this. */
  maxEtaSeconds?: number;
  /** Reject routes whose all-in payer cost exceeds this share of the ticket. */
  maxCostBps?: number;
}

export interface RouteLeg {
  kind: "transfer" | "convert" | "settle";
  label: string;
  detail: string;
  /** Cost attributable to this leg, in USD, as the payer experiences it. */
  costUsd: number;
  etaSeconds: number;
  /** Who absorbs the cost of this leg. */
  bornBy: "payer" | "platform" | "merchant";
}

export interface RouteCosts {
  /** Gas the payer spends broadcasting the transfer, in USD. */
  networkFeeUsd: number;
  /** Liquidity venue commission, in basis points of the ticket. */
  venueFeeBps: number;
  /** Slippage implied by the ticket size against venue depth, in basis points. */
  priceImpactBps: number;
  /** FX spread charged crossing into IDR, in basis points. */
  fxSpreadBps: number;
  /** CryptoQu's take rate, in basis points. */
  platformFeeBps: number;
  /** Everything above expressed as a single payer-side figure, in basis points. */
  totalBps: number;
  /** Everything above expressed in IDR. */
  totalCostIdr: number;
  /** IDR payout rail cost — absorbed by CryptoQu, shown for transparency. */
  railFeeIdr: number;
}

export interface Route {
  id: string;
  asset: AssetSymbol;
  chain: ChainId;
  venue: Venue;
  rail: SettlementRail;
  peg: PegStatus;
  /** Token units the payer sends, already rounded up to the asset's precision. */
  amountIn: number;
  /** Same figure in the asset's smallest unit, as a decimal string. */
  amountInMinor: string;
  /** IDR the merchant receives. */
  amountOutIdr: number;
  /** IDR per whole token the payer effectively pays. */
  effectiveRate: number;
  /** Mid-market IDR per token, before any CryptoQu cost. */
  referenceRate: number;
  costs: RouteCosts;
  etaSeconds: number;
  legs: RouteLeg[];
  /** Lower is better. Comparable only within one request. */
  score: number;
  warnings: string[];
}

export interface RoutePlan {
  amountIdr: number;
  objective: Objective;
  best: Route | null;
  routes: Route[];
  /** Routes that were considered and dropped, with the reason. */
  rejected: { asset: AssetSymbol; chain: ChainId; reason: string }[];
  degradedRates: boolean;
}

/** How aggressively ticket size eats into venue depth, in bps per unit of depth consumed. */
const IMPACT_COEFFICIENT = 2_500;

/** FX spread applied crossing each peg currency into rupiah. */
const FX_SPREAD_BPS: Record<FiatCurrency, number> = {
  IDR: 0,
  USD: 15,
  EUR: 25,
  SGD: 25,
};

/** Dollar value the objective assigns to one second of settlement latency. */
const TIME_VALUE_USD_PER_SECOND: Record<Objective, number> = {
  cost: 0.0002,
  balanced: 0.004,
  speed: 0.05,
};

export interface PlanContext {
  /** IDR rate per peg currency, keyed by currency. */
  rates: Record<FiatCurrency, RateSnapshot>;
}

export function planRoutes(request: RouteRequest, context: PlanContext): RoutePlan {
  const objective = request.objective ?? "balanced";
  const amountIdr = Math.round(request.amountIdr);
  const rejected: RoutePlan["rejected"] = [];
  const routes: Route[] = [];

  if (!Number.isFinite(amountIdr) || amountIdr < LIMITS.minAmountIdr) {
    throw new RouteError(
      `amount must be at least Rp${LIMITS.minAmountIdr.toLocaleString("id-ID")}`,
      "amount_too_small",
    );
  }
  if (amountIdr > LIMITS.maxAmountIdr) {
    throw new RouteError(
      `amount exceeds the Rp${LIMITS.maxAmountIdr.toLocaleString("id-ID")} QRIS transaction ceiling`,
      "amount_too_large",
    );
  }

  const assetFilter = request.assets?.length ? new Set(request.assets) : null;
  const chainFilter = request.chains?.length ? new Set(request.chains) : null;

  for (const asset of Object.values(ASSETS)) {
    if (assetFilter && !assetFilter.has(asset.symbol)) continue;

    const peg = getPegStatus(asset.symbol);
    const rate = context.rates[asset.pegCurrency];

    for (const chainId of asset.chains) {
      if (chainFilter && !chainFilter.has(chainId)) continue;

      if (!rate) {
        rejected.push({ asset: asset.symbol, chain: chainId, reason: "no rate for peg currency" });
        continue;
      }
      if (!peg.healthy) {
        rejected.push({
          asset: asset.symbol,
          chain: chainId,
          reason: `peg deviation ${peg.deviationBps}bps exceeds the ${LIMITS.maxPegDeviationBps}bps limit`,
        });
        continue;
      }

      const route = priceRoute({
        asset: asset.symbol,
        chain: chainId,
        amountIdr,
        rate,
        peg,
        objective,
        usdRate: context.rates.USD?.rate ?? 0,
      });

      if (!route.ok) {
        rejected.push({ asset: asset.symbol, chain: chainId, reason: route.reason });
        continue;
      }
      if (request.maxEtaSeconds !== undefined && route.route.etaSeconds > request.maxEtaSeconds) {
        rejected.push({ asset: asset.symbol, chain: chainId, reason: "slower than requested" });
        continue;
      }
      if (request.maxCostBps !== undefined && route.route.costs.totalBps > request.maxCostBps) {
        rejected.push({ asset: asset.symbol, chain: chainId, reason: "costlier than requested" });
        continue;
      }
      routes.push(route.route);
    }
  }

  routes.sort((a, b) => a.score - b.score);

  return {
    amountIdr,
    objective,
    best: routes[0] ?? null,
    routes,
    rejected,
    degradedRates: Object.values(context.rates).some((snapshot) => snapshot?.degraded),
  };
}

export class RouteError extends Error {
  constructor(
    message: string,
    readonly code: "amount_too_small" | "amount_too_large" | "no_route",
  ) {
    super(message);
    this.name = "RouteError";
  }
}

interface PriceInput {
  asset: AssetSymbol;
  chain: ChainId;
  amountIdr: number;
  rate: RateSnapshot;
  peg: PegStatus;
  objective: Objective;
  usdRate: number;
}

type PriceResult = { ok: true; route: Route } | { ok: false; reason: string };

function priceRoute(input: PriceInput): PriceResult {
  const asset = ASSETS[input.asset];
  const chain = CHAINS[input.chain];
  const warnings: string[] = [];

  // Ticket size in USD drives venue depth, ticket limits and impact.
  const usdRate = input.usdRate || 1;
  const sizeUsd = input.amountIdr / usdRate;

  const venue = pickVenue(input.asset, input.chain, sizeUsd, input.objective);
  if (!venue) return { ok: false, reason: "no venue with capacity for this asset and size" };

  const rail = pickRail(input.amountIdr);
  if (!rail) return { ok: false, reason: "no IDR payout rail accepts this amount" };

  const priceImpactBps = Math.round(IMPACT_COEFFICIENT * (sizeUsd / venue.depthUsd));
  const fxSpreadBps = FX_SPREAD_BPS[asset.pegCurrency];
  const totalBps = PLATFORM_FEE_BPS + venue.feeBps + priceImpactBps + fxSpreadBps;

  // Mid-market: how many rupiah one whole token is worth before any cost.
  const referenceRate = input.rate.rate * input.peg.price;
  if (referenceRate <= 0) return { ok: false, reason: "reference rate unavailable" };

  // The payer covers the merchant's rupiah plus the cost stack, denominated in tokens.
  const grossIdr = input.amountIdr * (1 + totalBps / 10_000);
  const rawAmountIn = grossIdr / referenceRate;
  const amountIn = roundUpTo(rawAmountIn, asset.decimals);
  if (!Number.isFinite(amountIn) || amountIn <= 0) {
    return { ok: false, reason: "amount rounds to zero at this asset's precision" };
  }

  const amountInMinor = toMinorUnits(amountIn, asset.decimals);
  const effectiveRate = input.amountIdr / amountIn;
  const totalCostIdr = Math.round(amountIn * referenceRate - input.amountIdr);
  const etaSeconds = chain.finalitySeconds + venue.latencySeconds + rail.latencySeconds;

  if (input.rate.degraded) {
    warnings.push("Quoted against the offline baseline rate — live FX feeds are unreachable.");
  }
  if (input.rate.dispersionBps > 50) {
    warnings.push(`FX sources disagree by ${input.rate.dispersionBps}bps.`);
  }
  if (priceImpactBps > 50) {
    warnings.push(`Ticket is large against ${venue.name} depth — ${priceImpactBps}bps of impact.`);
  }
  if (rail.operatingHours === "business") {
    warnings.push(`${rail.name} settles during banking hours only.`);
  }

  const costs: RouteCosts = {
    networkFeeUsd: chain.transferCostUsd,
    venueFeeBps: venue.feeBps,
    priceImpactBps,
    fxSpreadBps,
    platformFeeBps: PLATFORM_FEE_BPS,
    totalBps,
    totalCostIdr,
    railFeeIdr: rail.flatFeeIdr,
  };

  const legs: RouteLeg[] = [
    {
      kind: "transfer",
      label: `Send ${asset.symbol} on ${chain.name}`,
      detail: `${chain.confirmations} confirmation${chain.confirmations === 1 ? "" : "s"} before release`,
      costUsd: chain.transferCostUsd,
      etaSeconds: chain.finalitySeconds,
      bornBy: "payer",
    },
    {
      kind: "convert",
      label:
        asset.pegCurrency === "IDR"
          ? `Redeem ${asset.symbol} for rupiah`
          : `Convert ${asset.symbol} → IDR`,
      detail: `${venue.name} · ${venue.feeBps}bps fee · ${priceImpactBps}bps impact`,
      costUsd: (sizeUsd * (venue.feeBps + priceImpactBps)) / 10_000,
      etaSeconds: venue.latencySeconds,
      bornBy: "payer",
    },
    {
      kind: "settle",
      label: `Pay merchant via ${rail.name}`,
      detail: `Rp${rail.flatFeeIdr.toLocaleString("id-ID")} rail fee, absorbed by CryptoQu`,
      costUsd: rail.flatFeeIdr / usdRate,
      etaSeconds: rail.latencySeconds,
      bornBy: "platform",
    },
  ];

  const payerCostUsd = totalCostIdr / usdRate + chain.transferCostUsd;
  const score = payerCostUsd + etaSeconds * TIME_VALUE_USD_PER_SECOND[input.objective];

  return {
    ok: true,
    route: {
      id: `${input.asset}-${input.chain}-${venue.id}`,
      asset: input.asset,
      chain: input.chain,
      venue,
      rail,
      peg: input.peg,
      amountIn,
      amountInMinor,
      amountOutIdr: input.amountIdr,
      effectiveRate,
      referenceRate,
      costs,
      etaSeconds,
      legs,
      score,
      warnings,
    },
  };
}

/** Cheapest venue that can actually fill the ticket, tie-broken by the objective. */
function pickVenue(
  asset: AssetSymbol,
  chain: ChainId,
  sizeUsd: number,
  objective: Objective,
): Venue | undefined {
  const candidates = VENUES.filter(
    (venue) =>
      venue.assets.includes(asset) &&
      (venue.chains.length === 0 || venue.chains.includes(chain)) &&
      sizeUsd <= venue.maxTicketUsd,
  );
  if (candidates.length === 0) return undefined;

  const timeValue = TIME_VALUE_USD_PER_SECOND[objective];
  return candidates.reduce((best, venue) => {
    const cost = (v: Venue) =>
      (sizeUsd * (v.feeBps + IMPACT_COEFFICIENT * (sizeUsd / v.depthUsd))) / 10_000 +
      v.latencySeconds * timeValue;
    return cost(venue) < cost(best) ? venue : best;
  });
}

/** Cheapest 24/7 rail that can carry the amount, falling back to any rail that can. */
function pickRail(amountIdr: number): SettlementRail | undefined {
  const capable = SETTLEMENT_RAILS.filter((rail) => amountIdr <= rail.maxAmountIdr);
  if (capable.length === 0) return undefined;
  const alwaysOn = capable.filter((rail) => rail.operatingHours === "24/7");
  const pool = alwaysOn.length > 0 ? alwaysOn : capable;
  return pool.reduce((best, rail) => (rail.flatFeeIdr < best.flatFeeIdr ? rail : best));
}

/**
 * Rounds up to the asset's precision. Always up: rounding down would leave the
 * merchant a rupiah short and the payment would reconcile as underpaid.
 */
export function roundUpTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.ceil(value * factor - 1e-9) / factor;
}

/** Renders a token amount in its smallest on-chain unit, without floating point drift. */
export function toMinorUnits(value: number, decimals: number): string {
  const [whole, fraction = ""] = value.toFixed(decimals).split(".");
  return `${whole}${fraction}`.replace(/^0+(?=\d)/, "");
}
