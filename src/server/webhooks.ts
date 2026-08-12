/**
 * Webhook dispatch.
 *
 * Merchants learn about settlement from signed callbacks. Deliveries are
 * attempted with capped exponential backoff and every attempt is retained, so
 * a merchant integrating against CryptoQu can see exactly what was sent, when,
 * and what their endpoint answered.
 *
 * Signature scheme: `t=<unix>,v1=<hex>` where the HMAC-SHA256 payload is
 * `<unix>.<raw body>`. Receivers must compare in constant time and reject
 * timestamps outside their tolerance to make replay uninteresting.
 */

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import type { PaymentIntent } from "./intents";
import { getStore } from "./store";

export type WebhookEvent =
  | "payment_intent.created"
  | "payment_intent.funded"
  | "payment_intent.succeeded"
  | "payment_intent.failed"
  | "payment_intent.expired";

export interface WebhookAttempt {
  at: number;
  status: number | null;
  error?: string;
  durationMs: number;
}

export interface WebhookDelivery {
  id: string;
  merchantId?: string;
  event: WebhookEvent;
  url?: string;
  payload: unknown;
  createdAt: number;
  attempts: WebhookAttempt[];
  delivered: boolean;
  /** Null once the delivery has succeeded or exhausted its retries. */
  nextAttemptAt: number | null;
}

/** Backoff schedule in seconds. Five attempts spread over roughly ten minutes. */
const BACKOFF_SECONDS = [0, 10, 60, 180, 600];

export function enqueueWebhook(intent: PaymentIntent, event: WebhookEvent): WebhookDelivery {
  const store = getStore();
  const merchant = intent.merchantId ? store.merchants.get(intent.merchantId) : undefined;

  const delivery: WebhookDelivery = {
    id: `evt_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    merchantId: intent.merchantId,
    event,
    url: merchant?.webhookUrl,
    payload: buildPayload(intent, event),
    createdAt: Date.now(),
    attempts: [],
    delivered: false,
    nextAttemptAt: Date.now(),
  };

  store.deliveries.unshift(delivery);
  // Keep the retained log bounded; it is a debugging aid, not an archive.
  if (store.deliveries.length > 200) store.deliveries.length = 200;

  if (merchant?.webhookUrl) {
    // Fire and forget: settlement must not block on a merchant's endpoint.
    void attemptDelivery(delivery, merchant.webhookSecret);
  }
  return delivery;
}

function buildPayload(intent: PaymentIntent, event: WebhookEvent): unknown {
  return {
    id: `evt_${intent.id}_${event}`,
    type: event,
    createdAt: new Date().toISOString(),
    data: {
      intentId: intent.id,
      status: intent.status,
      merchantId: intent.merchantId,
      reference: intent.reference,
      amounts: intent.quote.amounts,
      asset: intent.quote.route.asset,
      chain: intent.quote.route.chain,
      amountIn: intent.quote.route.amountIn,
      txHash: intent.funding?.txHash,
      settledAt: intent.settledAt ? new Date(intent.settledAt).toISOString() : undefined,
      failureReason: intent.failureReason,
    },
  };
}

async function attemptDelivery(delivery: WebhookDelivery, secret: string): Promise<void> {
  if (!delivery.url) return;

  for (let attempt = 0; attempt < BACKOFF_SECONDS.length; attempt++) {
    if (attempt > 0) await sleep(BACKOFF_SECONDS[attempt] * 1_000);

    const body = JSON.stringify(delivery.payload);
    const startedAt = Date.now();
    try {
      const response = await fetch(delivery.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "CryptoQu-Webhooks/1.0",
          "x-cryptoqu-signature": signWebhook(body, secret),
          "x-cryptoqu-event": delivery.event,
        },
        body,
        signal: AbortSignal.timeout(8_000),
      });
      delivery.attempts.push({
        at: startedAt,
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
      if (response.ok) {
        delivery.delivered = true;
        delivery.nextAttemptAt = null;
        return;
      }
    } catch (error) {
      delivery.attempts.push({
        at: startedAt,
        status: null,
        error: (error as Error).message,
        durationMs: Date.now() - startedAt,
      });
    }

    const next = BACKOFF_SECONDS[attempt + 1];
    delivery.nextAttemptAt = next === undefined ? null : Date.now() + next * 1_000;
  }
}

/** Builds the `X-CryptoQu-Signature` header value for a raw body. */
export function signWebhook(body: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

/**
 * Verifies a signature header. Exported so merchants can copy it verbatim into
 * their own service, and so the docs page can demonstrate a real check.
 */
export function verifyWebhook(
  body: string,
  header: string,
  secret: string,
  toleranceSeconds = 300,
): boolean {
  const parts = Object.fromEntries(
    header.split(",").map((part) => {
      const [key, ...rest] = part.trim().split("=");
      return [key, rest.join("=")];
    }),
  );
  const timestamp = Number(parts.t);
  const provided = parts.v1;
  if (!Number.isFinite(timestamp) || !provided) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > toleranceSeconds) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

export function listDeliveries(limit = 25): WebhookDelivery[] {
  return getStore().deliveries.slice(0, limit);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
