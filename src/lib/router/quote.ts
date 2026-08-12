/**
 * Quote assembly.
 *
 * A quote binds a parsed QRIS code to a priced route for a fixed window. It is
 * signed so the intent endpoint can verify that the amounts it is asked to
 * commit to are the ones this service actually produced, rather than numbers a
 * client edited on the way back.
 */

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { computeTotalIdr, resolveMdr, type ParsedQris } from "@/lib/qris";
import { getRateSnapshot, type FiatCurrency, type RateSnapshot } from "./fx";
import { planRoutes, RouteError, type Objective, type Route, type RoutePlan } from "./engine";
import { LIMITS, type AssetSymbol, type ChainId } from "./registry";

export interface QuoteRequest {
  qris: ParsedQris;
  /** Overrides tag 54 — required when the code is static. */
  amountIdr?: number;
  assets?: AssetSymbol[];
  chains?: ChainId[];
  objective?: Objective;
}

export interface QuoteMerchant {
  name: string;
  city: string;
  nmid?: string;
  criteria?: string;
  mcc?: string;
  mccLabel: string;
  acquirers: string[];
}

export interface QuoteAmounts {
  /** Tag 54, or the caller's override for a static code. */
  baseIdr: number;
  /** Convenience fee encoded in tags 55-57. */
  tipIdr: number;
  /** What the merchant is owed — the figure the router must deliver. */
  totalIdr: number;
  /** Merchant Discount Rate deducted by the acquirer, borne by the merchant. */
  mdrBps: number;
  mdrIdr: number;
  mdrNote: string;
  /** What actually lands in the merchant's account. */
  merchantNetIdr: number;
}

export interface Quote {
  id: string;
  createdAt: number;
  expiresAt: number;
  ttlSeconds: number;
  merchant: QuoteMerchant;
  amounts: QuoteAmounts;
  route: Route;
  alternatives: Route[];
  rates: Record<string, { rate: number; sources: string[]; degraded: boolean; asOf: number }>;
  warnings: string[];
  signature: string;
}

export class QuoteError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "QuoteError";
  }
}

/** Peg currencies the router needs an IDR rate for. */
const RATE_CURRENCIES: FiatCurrency[] = ["USD", "IDR", "EUR", "SGD"];

export async function createQuote(request: QuoteRequest): Promise<Quote> {
  const { qris } = request;

  if (qris.amount === undefined && request.amountIdr === undefined) {
    throw new QuoteError(
      "this QRIS code carries no amount — supply amountIdr to quote it",
      "amount_required",
    );
  }
  if (qris.amount !== undefined && request.amountIdr !== undefined && request.amountIdr !== qris.amount) {
    throw new QuoteError(
      "this QRIS code fixes its own amount and cannot be overridden",
      "amount_locked",
    );
  }

  const baseIdr = Math.round(request.amountIdr ?? qris.amount ?? 0);
  const totalIdr = computeTotalIdr(qris, baseIdr);
  const tipIdr = totalIdr - baseIdr;

  const snapshots = await Promise.all(RATE_CURRENCIES.map((currency) => getRateSnapshot(currency)));
  const rates = Object.fromEntries(
    RATE_CURRENCIES.map((currency, index) => [currency, snapshots[index]]),
  ) as Record<FiatCurrency, RateSnapshot>;

  let plan: RoutePlan;
  try {
    plan = planRoutes(
      {
        amountIdr: totalIdr,
        assets: request.assets,
        chains: request.chains,
        objective: request.objective,
      },
      { rates },
    );
  } catch (error) {
    if (error instanceof RouteError) throw new QuoteError(error.message, error.code);
    throw error;
  }

  if (!plan.best) {
    throw new QuoteError("no route can settle this payment right now", "no_route");
  }

  const mdr = resolveMdr(qris.criteria, totalIdr);
  const mdrIdr = Math.round((totalIdr * mdr.bps) / 10_000);

  const createdAt = Date.now();
  const expiresAt = createdAt + LIMITS.quoteTtlSeconds * 1_000;

  const quote: Omit<Quote, "signature"> = {
    id: `qt_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    createdAt,
    expiresAt,
    ttlSeconds: LIMITS.quoteTtlSeconds,
    merchant: {
      name: qris.merchantName,
      city: qris.merchantCity,
      nmid: qris.nmid,
      criteria: qris.criteria,
      mcc: qris.mcc,
      mccLabel: qris.mccLabel,
      acquirers: [...new Set(qris.accounts.map((account) => account.acquirer))],
    },
    amounts: {
      baseIdr,
      tipIdr,
      totalIdr,
      mdrBps: mdr.bps,
      mdrIdr,
      mdrNote: mdr.note,
      merchantNetIdr: totalIdr - mdrIdr,
    },
    route: plan.best,
    alternatives: plan.routes.slice(1, 6),
    rates: Object.fromEntries(
      Object.entries(rates).map(([currency, snapshot]) => [
        currency,
        {
          rate: snapshot.rate,
          sources: snapshot.samples.map((sample) => sample.source),
          degraded: snapshot.degraded,
          asOf: snapshot.asOf,
        },
      ]),
    ),
    warnings: [...qris.warnings, ...plan.best.warnings],
  };

  return { ...quote, signature: signQuote(quote) };
}

/**
 * Signs the fields a client must not be able to change: the identity of the
 * quote, its deadline, the amounts, and the route's asset/chain/size.
 */
export function signQuote(quote: Omit<Quote, "signature">): string {
  return createHmac("sha256", quoteSecret()).update(canonicalise(quote)).digest("hex");
}

export function verifyQuote(quote: Quote): boolean {
  const expected = signQuote(stripSignature(quote));
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(quote.signature ?? "", "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

export function isExpired(quote: Quote, now = Date.now()): boolean {
  return now > quote.expiresAt;
}

function stripSignature(quote: Quote): Omit<Quote, "signature"> {
  const { signature: _signature, ...rest } = quote;
  return rest;
}

function canonicalise(quote: Omit<Quote, "signature">): string {
  return [
    quote.id,
    quote.createdAt,
    quote.expiresAt,
    quote.merchant.nmid ?? quote.merchant.name,
    quote.amounts.totalIdr,
    quote.amounts.merchantNetIdr,
    quote.route.asset,
    quote.route.chain,
    quote.route.amountInMinor,
    quote.route.venue.id,
    quote.route.rail.id,
  ].join("|");
}

/**
 * Signing key. A deployment sets CRYPTOQU_QUOTE_SECRET; without it the process
 * generates an ephemeral key, which keeps local development working while
 * guaranteeing quotes never verify across a restart.
 */
let ephemeralSecret: string | undefined;
function quoteSecret(): string {
  const configured = process.env.CRYPTOQU_QUOTE_SECRET;
  if (configured) return configured;
  ephemeralSecret ??= randomUUID();
  return ephemeralSecret;
}
