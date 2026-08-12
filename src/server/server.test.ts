import { describe, expect, it } from "vitest";

import { ACCOUNTS, fromMinor, Ledger, LedgerError, toMinor } from "./ledger";
import { advance, createIntent, fundIntent, getIntent, IntentError } from "./intents";
import { getStore } from "./store";
import { signWebhook, verifyWebhook } from "./webhooks";
import { createQuote, signQuote, verifyQuote, type Quote } from "@/lib/router";
import { mintQris, parseQris } from "@/lib/qris";

const QRIS = mintQris({
  merchantName: "Kopi Senja",
  merchantCity: "Bandung",
  nmid: "ID1024312341234",
  mcc: "5812",
  criteria: "UMI",
});

async function quoteFor(amountIdr: number): Promise<Quote> {
  return createQuote({ qris: parseQris(QRIS), amountIdr });
}

const VALID_TX = `0x${"a".repeat(64)}`;

describe("ledger", () => {
  function ledgerWithAccounts(): Ledger {
    const ledger = new Ledger();
    ledger.openAccount({ id: "asset:cash", name: "Cash", kind: "asset", currency: "IDR" });
    ledger.openAccount({ id: "revenue:fees", name: "Fees", kind: "revenue", currency: "IDR" });
    ledger.openAccount({ id: "asset:vault", name: "Vault", kind: "asset", currency: "USDC" });
    ledger.openAccount({
      id: "external:payer",
      name: "Payer",
      kind: "external",
      currency: "USDC",
    });
    return ledger;
  }

  it("accepts a balanced transaction and moves both balances", () => {
    const ledger = ledgerWithAccounts();
    ledger.post({
      id: "txn_1",
      reference: "ref_1",
      description: "fee earned",
      postings: [
        { accountId: "asset:cash", currency: "IDR", amount: 1_000n },
        { accountId: "revenue:fees", currency: "IDR", amount: -1_000n },
      ],
    });
    expect(ledger.balance("asset:cash", "IDR")).toBe(1_000n);
    expect(ledger.balance("revenue:fees", "IDR")).toBe(-1_000n);
    expect(ledger.isBalanced()).toBe(true);
  });

  it("refuses a transaction that does not balance", () => {
    const ledger = ledgerWithAccounts();
    expect(() =>
      ledger.post({
        id: "txn_bad",
        reference: "ref",
        description: "unbalanced",
        postings: [
          { accountId: "asset:cash", currency: "IDR", amount: 1_000n },
          { accountId: "revenue:fees", currency: "IDR", amount: -999n },
        ],
      }),
    ).toThrow(LedgerError);
  });

  it("balances each currency independently in a cross-currency transaction", () => {
    const ledger = ledgerWithAccounts();
    ledger.post({
      id: "txn_fx",
      reference: "ref",
      description: "conversion",
      postings: [
        { accountId: "asset:vault", currency: "USDC", amount: 1_000_000n },
        { accountId: "external:payer", currency: "USDC", amount: -1_000_000n },
        { accountId: "asset:cash", currency: "IDR", amount: 16_000n },
        { accountId: "revenue:fees", currency: "IDR", amount: -16_000n },
      ],
    });
    expect(ledger.isBalanced()).toBe(true);
  });

  it("rejects a posting whose currency the account does not hold", () => {
    const ledger = ledgerWithAccounts();
    expect(() =>
      ledger.post({
        id: "txn_wrong_currency",
        reference: "ref",
        description: "mismatch",
        postings: [
          { accountId: "asset:cash", currency: "USDC", amount: 1n },
          { accountId: "asset:vault", currency: "USDC", amount: -1n },
        ],
      }),
    ).toThrow(/holds IDR/);
  });

  it("rejects unknown accounts, single postings and zero amounts", () => {
    const ledger = ledgerWithAccounts();
    const base = { id: "t", reference: "r", description: "d" };
    expect(() =>
      ledger.post({
        ...base,
        postings: [
          { accountId: "nope", currency: "IDR", amount: 1n },
          { accountId: "asset:cash", currency: "IDR", amount: -1n },
        ],
      }),
    ).toThrow(/unknown account/);
    expect(() =>
      ledger.post({ ...base, postings: [{ accountId: "asset:cash", currency: "IDR", amount: 0n }] }),
    ).toThrow(/at least two postings/);
    expect(() =>
      ledger.post({
        ...base,
        postings: [
          { accountId: "asset:cash", currency: "IDR", amount: 0n },
          { accountId: "revenue:fees", currency: "IDR", amount: 0n },
        ],
      }),
    ).toThrow(/zero-value/);
  });

  it("converts to and from minor units without drift", () => {
    expect(toMinor(45_000, "IDR")).toBe(45_000n);
    expect(toMinor(1.5, "USDC")).toBe(1_500_000n);
    expect(toMinor(45_112.5, "IDRX")).toBe(4_511_250n);
    expect(toMinor(-2.25, "USDC")).toBe(-2_250_000n);

    expect(fromMinor(45_000n, "IDR")).toBe("45000");
    expect(fromMinor(1_500_000n, "USDC")).toBe("1.500000");
    expect(fromMinor(-2_250_000n, "USDC")).toBe("-2.250000");
    expect(fromMinor(25n, "IDRX")).toBe("0.25");
  });
});

describe("quote signing", () => {
  it("verifies a quote it produced", async () => {
    const quote = await quoteFor(45_000);
    expect(verifyQuote(quote)).toBe(true);
  });

  it("rejects a quote whose amount was edited in transit", async () => {
    const quote = await quoteFor(45_000);
    const tampered: Quote = {
      ...quote,
      amounts: { ...quote.amounts, totalIdr: 1_000 },
    };
    expect(verifyQuote(tampered)).toBe(false);
  });

  it("rejects a quote whose route size was edited", async () => {
    const quote = await quoteFor(45_000);
    const tampered: Quote = {
      ...quote,
      route: { ...quote.route, amountInMinor: "1" },
    };
    expect(verifyQuote(tampered)).toBe(false);
  });

  it("rejects a missing or malformed signature", async () => {
    const quote = await quoteFor(45_000);
    expect(verifyQuote({ ...quote, signature: "" })).toBe(false);
    expect(verifyQuote({ ...quote, signature: "zz" })).toBe(false);
  });
});

describe("payment intent lifecycle", () => {
  it("refuses to create an intent from an unsigned quote", async () => {
    const quote = await quoteFor(45_000);
    expect(() => createIntent({ quote: { ...quote, signature: "00" } })).toThrow(IntentError);
  });

  it("refuses a quote that lapsed before it was committed", async () => {
    const quote = await quoteFor(45_000);
    // The deadline is part of the signed payload, so a genuinely expired quote
    // has to be re-signed rather than edited — otherwise the signature check
    // fires first and we would never reach the expiry branch.
    const { signature: _old, ...rest } = quote;
    const lapsed = { ...rest, expiresAt: Date.now() - 1_000 };
    const expired: Quote = { ...lapsed, signature: signQuote(lapsed) };

    expect(verifyQuote(expired)).toBe(true);
    expect(() => createIntent({ quote: expired })).toThrow(/expired/);
  });

  it("walks every phase in order and settles", async () => {
    const quote = await quoteFor(45_000);
    const intent = createIntent({ quote, merchantId: "mch_demo_kopisenja" });
    expect(intent.status).toBe("requires_payment");

    fundIntent(intent.id, { txHash: VALID_TX });
    expect(intent.status).toBe("confirming");

    const settleAt = intent.funding!.at + (intent.quote.route.etaSeconds + 1) * 1_000;
    advance(intent, settleAt);

    expect(intent.status).toBe("succeeded");
    // Read timing must not change the audit trail: every phase is recorded even
    // though the intent was only read once, after settlement.
    expect(intent.events.map((event) => event.status)).toEqual([
      "requires_payment",
      "confirming",
      "converting",
      "settling",
      "succeeded",
    ]);
  });

  it("records identical events whether polled continuously or read once", async () => {
    const polled = createIntent({ quote: await quoteFor(60_000) });
    const readOnce = createIntent({ quote: await quoteFor(60_000) });
    fundIntent(polled.id, { txHash: VALID_TX });
    fundIntent(readOnce.id, { txHash: VALID_TX });

    const total = polled.quote.route.etaSeconds + 1;
    for (let second = 0; second <= total; second++) {
      advance(polled, polled.funding!.at + second * 1_000);
    }
    advance(readOnce, readOnce.funding!.at + total * 1_000);

    expect(readOnce.events.map((e) => e.status)).toEqual(polled.events.map((e) => e.status));
  });

  it("posts three balanced ledger transactions on settlement", async () => {
    const store = getStore();
    const intent = createIntent({
      quote: await quoteFor(120_000),
      merchantId: "mch_demo_kopisenja",
    });
    fundIntent(intent.id, { txHash: VALID_TX });
    advance(intent, intent.funding!.at + (intent.quote.route.etaSeconds + 1) * 1_000);

    const entries = store.ledger.historyFor(intent.id);
    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.id)).toEqual([
      `txn_${intent.id}_funding`,
      `txn_${intent.id}_conversion`,
      `txn_${intent.id}_payout`,
    ]);
    expect(store.ledger.isBalanced()).toBe(true);
  });

  it("leaves the merchant payable at zero once paid out", async () => {
    const store = getStore();
    const merchantId = "mch_demo_kopisenja";
    const before = store.ledger.balance(ACCOUNTS.merchantPayable(merchantId), "IDR");

    const intent = createIntent({ quote: await quoteFor(75_000), merchantId });
    fundIntent(intent.id, { txHash: VALID_TX });
    advance(intent, intent.funding!.at + (intent.quote.route.etaSeconds + 1) * 1_000);

    expect(store.ledger.balance(ACCOUNTS.merchantPayable(merchantId), "IDR")).toBe(before);
  });

  it("posts to the ledger exactly once no matter how often it is read", async () => {
    const store = getStore();
    const intent = createIntent({ quote: await quoteFor(50_000), merchantId: "mch_demo_kopisenja" });
    fundIntent(intent.id, { txHash: VALID_TX });

    const settled = intent.funding!.at + (intent.quote.route.etaSeconds + 1) * 1_000;
    for (let i = 0; i < 5; i++) advance(intent, settled);
    getIntent(intent.id);

    expect(store.ledger.historyFor(intent.id)).toHaveLength(3);
    expect(store.ledger.isBalanced()).toBe(true);
  });

  it("expires an intent that is never funded", async () => {
    const intent = createIntent({ quote: await quoteFor(45_000) });
    advance(intent, intent.expiresAt + 1_000);
    expect(intent.status).toBe("expired");
  });

  it("rejects an underpayment and fails the intent", async () => {
    const intent = createIntent({ quote: await quoteFor(45_000) });
    expect(() => fundIntent(intent.id, { txHash: VALID_TX, amountMinor: "1" })).toThrow(/underpaid/);
    expect(intent.status).toBe("failed");
  });

  it("accepts an overpayment rather than stranding the funds", async () => {
    const intent = createIntent({ quote: await quoteFor(45_000) });
    const over = (BigInt(intent.quote.route.amountInMinor) + 1_000n).toString();
    fundIntent(intent.id, { txHash: VALID_TX, amountMinor: over });
    expect(intent.status).toBe("confirming");
  });

  it("rejects a malformed transaction hash", async () => {
    const intent = createIntent({ quote: await quoteFor(45_000) });
    expect(() => fundIntent(intent.id, { txHash: "0xdeadbeef" })).toThrow(/valid EVM or Solana/);
  });

  it("refuses to fund the same intent twice", async () => {
    const intent = createIntent({ quote: await quoteFor(45_000) });
    fundIntent(intent.id, { txHash: VALID_TX });
    expect(() => fundIntent(intent.id, { txHash: VALID_TX })).toThrow(/already/);
  });

  it("reports a missing intent rather than inventing one", () => {
    expect(() => getIntent("pi_does_not_exist")).toThrow(IntentError);
  });
});

describe("webhook signatures", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ type: "payment_intent.succeeded" });

  it("verifies a signature it produced", () => {
    expect(verifyWebhook(body, signWebhook(body, secret), secret)).toBe(true);
  });

  it("rejects a body that changed after signing", () => {
    const header = signWebhook(body, secret);
    expect(verifyWebhook(`${body} `, header, secret)).toBe(false);
  });

  it("rejects the wrong secret", () => {
    expect(verifyWebhook(body, signWebhook(body, secret), "whsec_other")).toBe(false);
  });

  it("rejects a replayed signature outside the tolerance window", () => {
    const old = Math.floor(Date.now() / 1000) - 3_600;
    expect(verifyWebhook(body, signWebhook(body, secret, old), secret)).toBe(false);
    // Still valid when the receiver opts into a wider window.
    expect(verifyWebhook(body, signWebhook(body, secret, old), secret, 7_200)).toBe(true);
  });

  it("rejects a malformed header", () => {
    expect(verifyWebhook(body, "garbage", secret)).toBe(false);
    expect(verifyWebhook(body, "t=abc,v1=zz", secret)).toBe(false);
  });
});
