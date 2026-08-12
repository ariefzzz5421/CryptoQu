/**
 * Process-local persistence.
 *
 * Everything the API needs lives behind this one module so swapping it for
 * Postgres means implementing `Store`, not touching route handlers. The
 * in-memory implementation is deliberately the only one checked in: it makes
 * the service runnable with no infrastructure, and it is scoped to a single
 * process so nothing here is mistaken for a durable system of record.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { ACCOUNTS, Ledger, type Currency } from "./ledger";
import type { PaymentIntent } from "./intents";
import type { WebhookDelivery } from "./webhooks";
import { CHAINS, type AssetSymbol } from "@/lib/router";

export interface Merchant {
  id: string;
  /** Display name, mirrored into tag 59 of any code we mint. */
  name: string;
  city: string;
  /** National Merchant ID. */
  nmid: string;
  criteria: string;
  mcc?: string;
  /** Static QRIS payload this merchant presents, when they have one. */
  staticQris?: string;
  /** Where settlement lands. */
  payout: { bank: string; accountNumber: string; accountName: string };
  webhookUrl?: string;
  webhookSecret: string;
  createdAt: number;
  live: boolean;
}

export interface ApiKey {
  /** The `cq_live_…` prefix shown in dashboards; the secret itself is not stored. */
  id: string;
  merchantId: string;
  label: string;
  hash: string;
  createdAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
}

export interface Store {
  ledger: Ledger;
  merchants: Map<string, Merchant>;
  apiKeys: Map<string, ApiKey>;
  intents: Map<string, PaymentIntent>;
  deliveries: WebhookDelivery[];
  idempotency: Map<string, { status: number; body: unknown; createdAt: number }>;
  rateLimit: Map<string, { tokens: number; updatedAt: number }>;
}

declare global {
  // Next.js reloads modules in development; the store must survive that.
  var __cryptoquStore: Store | undefined;
}

function createStore(): Store {
  const store: Store = {
    ledger: new Ledger(),
    merchants: new Map(),
    apiKeys: new Map(),
    intents: new Map(),
    deliveries: [],
    idempotency: new Map(),
    rateLimit: new Map(),
  };
  seedAccounts(store.ledger);
  seedDemoMerchant(store);
  return store;
}

export function getStore(): Store {
  globalThis.__cryptoquStore ??= createStore();
  return globalThis.__cryptoquStore;
}

/** Opens the chart of accounts the settlement engine posts against. */
function seedAccounts(ledger: Ledger): void {
  const tokenCurrencies: Currency[] = ["USDC", "USDT", "IDRX", "PYUSD", "EURC", "XSGD"];

  ledger.openAccount({
    id: ACCOUNTS.fiatFloat,
    name: "Rupiah settlement float",
    kind: "asset",
    currency: "IDR",
  });
  ledger.openAccount({
    id: ACCOUNTS.platformRevenue,
    name: "Platform fee revenue",
    kind: "revenue",
    currency: "IDR",
  });
  ledger.openAccount({
    id: ACCOUNTS.railExpense,
    name: "Settlement rail fees",
    kind: "expense",
    currency: "IDR",
  });
  ledger.openAccount({
    id: ACCOUNTS.acquirerExternal,
    name: "QRIS acquirer",
    kind: "external",
    currency: "IDR",
  });

  for (const currency of tokenCurrencies) {
    ledger.openAccount({
      id: ACCOUNTS.payerExternal(currency),
      name: `Payer wallets (${currency})`,
      kind: "external",
      currency,
    });
    for (const chain of Object.keys(CHAINS)) {
      ledger.openAccount({
        id: ACCOUNTS.vault(chain, currency),
        name: `${currency} vault on ${CHAINS[chain as keyof typeof CHAINS].name}`,
        kind: "asset",
        currency,
      });
    }
  }
}

/**
 * A merchant that exists from a cold start so the dashboard and the API
 * playground have something real to act on.
 */
function seedDemoMerchant(store: Store): void {
  const merchant: Merchant = {
    id: "mch_demo_kopisenja",
    name: "Kopi Senja",
    city: "Bandung",
    nmid: "ID1024312341234",
    criteria: "UMI",
    mcc: "5812",
    payout: { bank: "BCA", accountNumber: "•••• 4821", accountName: "PT Kopi Senja Nusantara" },
    webhookSecret: `whsec_${randomBytes(16).toString("hex")}`,
    createdAt: Date.now(),
    live: false,
  };
  store.merchants.set(merchant.id, merchant);
  openMerchantAccount(store, merchant.id);
}

export function openMerchantAccount(store: Store, merchantId: string): void {
  store.ledger.openAccount({
    id: ACCOUNTS.merchantPayable(merchantId),
    name: `Payable to ${merchantId}`,
    kind: "liability",
    currency: "IDR",
  });
}

/** Opens the venue-facing clearing accounts a route needs, on first use. */
export function ensureClearingAccounts(
  store: Store,
  venueId: string,
  asset: AssetSymbol,
): void {
  store.ledger.openAccount({
    id: ACCOUNTS.conversionClearing(venueId, asset as Currency),
    name: `${venueId} position (${asset})`,
    kind: "clearing",
    currency: asset as Currency,
  });
}

export function createMerchant(input: {
  name: string;
  city: string;
  nmid: string;
  criteria?: string;
  mcc?: string;
  payout: Merchant["payout"];
  webhookUrl?: string;
}): Merchant {
  const store = getStore();
  const merchant: Merchant = {
    id: `mch_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
    name: input.name,
    city: input.city,
    nmid: input.nmid,
    criteria: (input.criteria ?? "UMI").toUpperCase(),
    mcc: input.mcc,
    payout: input.payout,
    webhookUrl: input.webhookUrl,
    webhookSecret: `whsec_${randomBytes(16).toString("hex")}`,
    createdAt: Date.now(),
    live: false,
  };
  store.merchants.set(merchant.id, merchant);
  openMerchantAccount(store, merchant.id);
  return merchant;
}

/**
 * Mints an API key. The plaintext is returned exactly once; only its SHA-256
 * digest is retained, so a leak of the store cannot be replayed as credentials.
 */
export function issueApiKey(merchantId: string, label: string): { key: ApiKey; secret: string } {
  const store = getStore();
  const secret = `cq_test_${randomBytes(24).toString("hex")}`;
  const key: ApiKey = {
    id: `key_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    merchantId,
    label,
    hash: hashSecret(secret),
    createdAt: Date.now(),
  };
  store.apiKeys.set(key.id, key);
  return { key, secret };
}

export function findApiKey(secret: string): ApiKey | undefined {
  const store = getStore();
  const hash = hashSecret(secret);
  for (const key of store.apiKeys.values()) {
    if (key.hash === hash && !key.revokedAt) return key;
  }
  return undefined;
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}
