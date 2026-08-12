/**
 * Payment intents — the lifecycle of one QRIS payment funded with stablecoins.
 *
 * An intent is created from a signed quote, funded by an on-chain transfer,
 * and then walks a fixed state machine to settlement. Progress is derived from
 * elapsed time against the route's own leg estimates, so reading an intent is a
 * pure function of its recorded facts and the clock — no background worker has
 * to have run for the state to be correct.
 */

import { randomUUID } from "node:crypto";

import { ACCOUNTS, toMinor, type Currency } from "./ledger";
import { ensureClearingAccounts, getStore, type Store } from "./store";
import { enqueueWebhook } from "./webhooks";
import { isExpired, verifyQuote, type Quote } from "@/lib/router";

export type IntentStatus =
  | "requires_payment"
  | "confirming"
  | "converting"
  | "settling"
  | "succeeded"
  | "expired"
  | "failed";

export interface IntentEvent {
  at: number;
  status: IntentStatus;
  message: string;
}

export interface PaymentIntent {
  id: string;
  merchantId?: string;
  status: IntentStatus;
  createdAt: number;
  /** Deadline for the payer's funds to appear on chain. */
  expiresAt: number;
  quote: Quote;
  /** Address the payer sends to — one per intent, so funds self-reconcile. */
  depositAddress: string;
  /** Set once a funding transfer is recorded. */
  funding?: { txHash: string; at: number; amountMinor: string };
  settledAt?: number;
  /** Reference written into tag 62 sub-tag 05 for acquirer reconciliation. */
  reference: string;
  events: IntentEvent[];
  failureReason?: string;
  /** True once the ledger entries for this intent have been written. */
  posted: boolean;
}

export class IntentError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "IntentError";
  }
}

/** How long a payer has to fund an intent before it lapses. */
const FUNDING_WINDOW_SECONDS = 15 * 60;

export function createIntent(input: { quote: Quote; merchantId?: string }): PaymentIntent {
  const store = getStore();
  const { quote } = input;

  if (!verifyQuote(quote)) {
    throw new IntentError("quote signature is invalid or the quote was modified", "invalid_quote");
  }
  if (isExpired(quote)) {
    throw new IntentError("quote has expired — request a new one", "quote_expired", 409);
  }
  if (input.merchantId && !store.merchants.has(input.merchantId)) {
    throw new IntentError("unknown merchant", "merchant_not_found", 404);
  }

  const now = Date.now();
  const intent: PaymentIntent = {
    id: `pi_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    merchantId: input.merchantId,
    status: "requires_payment",
    createdAt: now,
    expiresAt: now + FUNDING_WINDOW_SECONDS * 1_000,
    quote,
    depositAddress: deriveDepositAddress(quote),
    reference: `CQ-${now.toString(36).toUpperCase()}`,
    events: [
      {
        at: now,
        status: "requires_payment",
        message: `Awaiting ${quote.route.amountIn} ${quote.route.asset} on ${quote.route.chain}`,
      },
    ],
    posted: false,
  };

  store.intents.set(intent.id, intent);
  enqueueWebhook(intent, "payment_intent.created");
  return intent;
}

/**
 * Records the payer's on-chain transfer. This is the only externally driven
 * transition; everything after it is time-based.
 */
export function fundIntent(intentId: string, input: { txHash: string; amountMinor?: string }): PaymentIntent {
  const store = getStore();
  const intent = requireIntent(store, intentId);
  advance(intent);

  if (intent.status === "expired") {
    throw new IntentError("intent expired before funds arrived", "intent_expired", 409);
  }
  if (intent.status !== "requires_payment") {
    throw new IntentError(`intent is already ${intent.status}`, "already_funded", 409);
  }
  if (!/^(0x[0-9a-fA-F]{64}|[1-9A-HJ-NP-Za-km-z]{64,90})$/.test(input.txHash)) {
    throw new IntentError("txHash is not a valid EVM or Solana transaction hash", "invalid_tx_hash");
  }

  const expected = BigInt(intent.quote.route.amountInMinor);
  const received = input.amountMinor ? BigInt(input.amountMinor) : expected;
  if (received < expected) {
    intent.status = "failed";
    intent.failureReason = `underpaid: received ${received}, expected ${expected} minor units`;
    pushEvent(intent, "failed", intent.failureReason);
    enqueueWebhook(intent, "payment_intent.failed");
    throw new IntentError(intent.failureReason, "underpaid", 409);
  }

  const now = Date.now();
  intent.funding = { txHash: input.txHash, at: now, amountMinor: received.toString() };
  intent.status = "confirming";
  pushEvent(intent, "confirming", `Transfer ${shorten(input.txHash)} seen, waiting for finality`);
  enqueueWebhook(intent, "payment_intent.funded");
  return intent;
}

/** Reads an intent, advancing its derived state first. */
export function getIntent(intentId: string): PaymentIntent {
  const intent = requireIntent(getStore(), intentId);
  advance(intent);
  return intent;
}

export function listIntents(limit = 25): PaymentIntent[] {
  const store = getStore();
  const intents = [...store.intents.values()];
  for (const intent of intents) advance(intent);
  return intents.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

/**
 * Moves an intent to whatever state its own timeline implies. Idempotent, and
 * safe to call on every read: each transition fires its side effects once.
 */
export function advance(intent: PaymentIntent, now = Date.now()): PaymentIntent {
  if (isTerminal(intent.status)) return intent;

  if (!intent.funding) {
    if (now > intent.expiresAt) {
      intent.status = "expired";
      pushEvent(intent, "expired", "No funds arrived before the intent lapsed");
      enqueueWebhook(intent, "payment_intent.expired");
    }
    return intent;
  }

  const route = intent.quote.route;
  const fundedAt = intent.funding.at;
  const confirmDone = route.legs[0].etaSeconds;
  const convertDone = confirmDone + route.legs[1].etaSeconds;
  const settleDone = convertDone + route.legs[2].etaSeconds;

  /**
   * The phases in the order they occur, each with the moment it begins. Every
   * phase whose start has passed is applied, not just the latest one — the
   * event log has to read the same whether it was polled every second or read
   * once after settlement.
   */
  const phases: { status: IntentStatus; at: number; message: string }[] = [
    {
      status: "converting",
      at: fundedAt + confirmDone * 1_000,
      message: `Converting ${route.asset} to rupiah at ${route.venue.name}`,
    },
    {
      status: "settling",
      at: fundedAt + convertDone * 1_000,
      message: `Paying out over ${route.rail.name}`,
    },
    {
      status: "succeeded",
      at: fundedAt + settleDone * 1_000,
      message: `Rp${intent.quote.amounts.merchantNetIdr.toLocaleString("id-ID")} settled to the merchant via ${route.rail.name}`,
    },
  ];

  for (const phase of phases) {
    if (now < phase.at) break;
    if (intent.events.some((event) => event.status === phase.status)) continue;

    if (phase.status === "succeeded") {
      postSettlement(intent);
      intent.settledAt = phase.at;
    }
    intent.status = phase.status;
    // Stamped with when the phase actually began, not when it was observed.
    intent.events.push({ at: phase.at, status: phase.status, message: phase.message });
    if (phase.status === "succeeded") enqueueWebhook(intent, "payment_intent.succeeded");
  }

  return intent;
}

export function isTerminal(status: IntentStatus): boolean {
  return status === "succeeded" || status === "expired" || status === "failed";
}

/**
 * Writes the double-entry records for a settled payment.
 *
 * Three transactions, in the order the money actually moves: the payer's
 * transfer lands in a vault, the vault is sold to the liquidity venue for
 * rupiah while recognising what the merchant is owed and what CryptoQu earned,
 * and finally the rupiah leaves the float over a payout rail.
 */
function postSettlement(intent: PaymentIntent): void {
  if (intent.posted || !intent.funding) return;
  const store = getStore();
  const route = intent.quote.route;
  const asset = route.asset as Currency;
  const merchantId = intent.merchantId ?? "unassigned";

  if (!store.ledger.getAccount(ACCOUNTS.merchantPayable(merchantId))) {
    store.ledger.openAccount({
      id: ACCOUNTS.merchantPayable(merchantId),
      name: `Payable to ${merchantId}`,
      kind: "liability",
      currency: "IDR",
    });
  }
  ensureClearingAccounts(store, route.venue.id, route.asset);

  const amountIn = BigInt(intent.funding.amountMinor);
  const totalIdr = toMinor(intent.quote.amounts.totalIdr, "IDR");
  const railFee = toMinor(route.rail.flatFeeIdr, "IDR");

  // What the venue hands back after its own fee and the size impact.
  const grossIdr = route.amountIn * route.referenceRate;
  const venueCostBps = route.costs.venueFeeBps + route.costs.priceImpactBps;
  const proceedsIdr = toMinor(Math.floor(grossIdr * (1 - venueCostBps / 10_000)), "IDR");
  const platformRevenue = proceedsIdr - totalIdr;

  store.ledger.post({
    id: `txn_${intent.id}_funding`,
    reference: intent.id,
    description: `Payer transfer ${shorten(intent.funding.txHash)}`,
    postings: [
      { accountId: ACCOUNTS.vault(route.chain, asset), currency: asset, amount: amountIn },
      { accountId: ACCOUNTS.payerExternal(asset), currency: asset, amount: -amountIn },
    ],
  });

  store.ledger.post({
    id: `txn_${intent.id}_conversion`,
    reference: intent.id,
    description: `Convert ${route.asset} to IDR at ${route.venue.name}`,
    postings: [
      { accountId: ACCOUNTS.vault(route.chain, asset), currency: asset, amount: -amountIn },
      {
        accountId: ACCOUNTS.conversionClearing(route.venue.id, asset),
        currency: asset,
        amount: amountIn,
      },
      { accountId: ACCOUNTS.fiatFloat, currency: "IDR", amount: proceedsIdr },
      { accountId: ACCOUNTS.merchantPayable(merchantId), currency: "IDR", amount: -totalIdr },
      ...(platformRevenue !== 0n
        ? [
            {
              accountId: ACCOUNTS.platformRevenue,
              currency: "IDR" as Currency,
              amount: -platformRevenue,
            },
          ]
        : []),
    ],
  });

  store.ledger.post({
    id: `txn_${intent.id}_payout`,
    reference: intent.id,
    description: `Payout to merchant over ${route.rail.name}`,
    postings: [
      { accountId: ACCOUNTS.merchantPayable(merchantId), currency: "IDR", amount: totalIdr },
      ...(railFee !== 0n
        ? [{ accountId: ACCOUNTS.railExpense, currency: "IDR" as Currency, amount: railFee }]
        : []),
      { accountId: ACCOUNTS.fiatFloat, currency: "IDR", amount: -(totalIdr + railFee) },
    ],
  });

  intent.posted = true;
}

function requireIntent(store: Store, intentId: string): PaymentIntent {
  const intent = store.intents.get(intentId);
  if (!intent) throw new IntentError("payment intent not found", "not_found", 404);
  return intent;
}

function pushEvent(intent: PaymentIntent, status: IntentStatus, message: string): void {
  intent.events.push({ at: Date.now(), status, message });
}

/**
 * Per-intent deposit address. Derived from the intent's quote so the same quote
 * always maps to the same address; a production deployment swaps this for an
 * address from the custody provider's derivation path.
 */
function deriveDepositAddress(quote: Quote): string {
  const seed = `${quote.id}${quote.route.chain}`;
  let hash = 0n;
  for (const char of seed) hash = (hash * 31n + BigInt(char.charCodeAt(0))) % (1n << 160n);
  const hex = hash.toString(16).padStart(40, "0");
  return quote.route.chain === "solana" ? base58ish(hex) : `0x${hex}`;
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58ish(hex: string): string {
  let value = BigInt(`0x${hex}`);
  let out = "";
  while (value > 0n) {
    out = BASE58[Number(value % 58n)] + out;
    value /= 58n;
  }
  return out.padStart(44, "1").slice(0, 44);
}

function shorten(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}
