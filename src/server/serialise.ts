/**
 * Wire shapes for the v1 API. Keeping these out of the route files means the
 * stored objects can carry internal bookkeeping (ledger posting flags, raw TLV)
 * without any of it leaking into a response.
 */

import type { PaymentIntent } from "./intents";
import type { WebhookDelivery } from "./webhooks";
import type { Merchant } from "./store";

export function serialiseIntent(intent: PaymentIntent) {
  return {
    id: intent.id,
    status: intent.status,
    merchantId: intent.merchantId,
    reference: intent.reference,
    createdAt: new Date(intent.createdAt).toISOString(),
    expiresAt: new Date(intent.expiresAt).toISOString(),
    settledAt: intent.settledAt ? new Date(intent.settledAt).toISOString() : undefined,
    depositAddress: intent.depositAddress,
    amounts: intent.quote.amounts,
    merchant: intent.quote.merchant,
    payment: {
      asset: intent.quote.route.asset,
      chain: intent.quote.route.chain,
      amountIn: intent.quote.route.amountIn,
      amountInMinor: intent.quote.route.amountInMinor,
      effectiveRate: intent.quote.route.effectiveRate,
      referenceRate: intent.quote.route.referenceRate,
      venue: intent.quote.route.venue.name,
      rail: intent.quote.route.rail.name,
      etaSeconds: intent.quote.route.etaSeconds,
      costs: intent.quote.route.costs,
      legs: intent.quote.route.legs,
    },
    funding: intent.funding,
    events: intent.events.map((event) => ({
      at: new Date(event.at).toISOString(),
      status: event.status,
      message: event.message,
    })),
    failureReason: intent.failureReason,
  };
}

export function serialiseMerchant(merchant: Merchant) {
  return {
    id: merchant.id,
    name: merchant.name,
    city: merchant.city,
    nmid: merchant.nmid,
    criteria: merchant.criteria,
    mcc: merchant.mcc,
    payout: merchant.payout,
    webhookUrl: merchant.webhookUrl,
    live: merchant.live,
    createdAt: new Date(merchant.createdAt).toISOString(),
  };
}

export function serialiseDelivery(delivery: WebhookDelivery) {
  return {
    id: delivery.id,
    event: delivery.event,
    merchantId: delivery.merchantId,
    url: delivery.url,
    delivered: delivery.delivered,
    createdAt: new Date(delivery.createdAt).toISOString(),
    nextAttemptAt: delivery.nextAttemptAt ? new Date(delivery.nextAttemptAt).toISOString() : null,
    attempts: delivery.attempts.map((attempt) => ({
      at: new Date(attempt.at).toISOString(),
      status: attempt.status,
      error: attempt.error,
      durationMs: attempt.durationMs,
    })),
    payload: delivery.payload,
  };
}
