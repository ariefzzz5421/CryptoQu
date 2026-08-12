import type { Metadata } from "next";

import { Playground, type Endpoint } from "@/components/docs/playground";
import { DEFAULT_DEMO } from "@/lib/demo";
import { LIMITS } from "@/lib/router";

export const metadata: Metadata = {
  title: "API reference",
  description:
    "Decode QRIS codes, price stablecoin routes, commit payment intents and verify webhooks. The CryptoQu v1 REST API.",
};

export const dynamic = "force-dynamic";

const ENDPOINTS: Endpoint[] = [
  {
    method: "POST",
    path: "/api/v1/qris/decode",
    summary:
      "Parses a QRIS payload into merchant identity, amounts and the raw TLV tree. Rejects a payload whose tag-63 checksum does not match unless enforceChecksum is false.",
    body: { payload: DEFAULT_DEMO.payload },
  },
  {
    method: "POST",
    path: "/api/v1/quotes",
    summary:
      "Prices the payment across every accepted asset and chain and returns the winning route, up to five alternatives, and a signature binding the amounts. Honours objective: cost, speed or balanced.",
    body: { payload: DEFAULT_DEMO.payload, amountIdr: 45_000, objective: "cost" },
  },
  {
    method: "POST",
    path: "/api/v1/qris/dynamic",
    summary:
      "Promotes a static code to a dynamic one carrying an amount: writes tag 54, flips tag 01, merges tag 62 and recomputes the CRC. Accepts an Idempotency-Key header.",
    body: { payload: DEFAULT_DEMO.payload, amountIdr: 27_500, referenceLabel: "INV-1042" },
  },
  {
    method: "POST",
    path: "/api/v1/intents",
    summary:
      "Commits a signed quote into a payment intent with its own deposit address. The quote must verify and must not have expired.",
    body: { quote: "// paste the object returned by POST /v1/quotes" },
  },
  {
    method: "GET",
    path: "/api/v1/intents",
    summary: "Lists recent payment intents, newest first, each advanced to its current state.",
  },
  {
    method: "GET",
    path: "/api/v1/rates",
    summary:
      "Current IDR rates per peg currency — the median of independent feeds, with each source shown — plus peg health for every accepted token.",
  },
  {
    method: "GET",
    path: "/api/v1/assets",
    summary:
      "The full acceptance surface: assets, chains, liquidity venues, payout rails, limits and the Bank Indonesia MDR schedule.",
  },
  {
    method: "GET",
    path: "/api/v1/ledger",
    summary:
      "The books. Trial balance, non-zero accounts and recent postings. Pass ?reference=pi_… to see one payment's entries.",
  },
  {
    method: "GET",
    path: "/api/v1/health",
    summary: "Liveness plus the state of the two things that decide whether we can quote at all.",
  },
];

export default function DocsPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-12 sm:py-16">
      <header className="mb-12 max-w-2xl">
        <p className="eyebrow">API reference</p>
        <h1 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          Everything the demo does, your integration can do
        </h1>
        <p className="mt-4 text-pretty text-sm leading-relaxed text-[var(--color-mist-500)]">
          A JSON REST API over HTTPS. Requests are rate limited per key, mutations honour{" "}
          <code className="num text-[var(--color-mint-300)]">Idempotency-Key</code>, and every error
          carries a machine-readable code.
        </p>
      </header>

      <section id="quickstart" className="mb-16 scroll-mt-24">
        <SectionTitle>Quickstart</SectionTitle>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <Step
            n="1"
            title="Decode"
            body="Send the scanned payload. You get the merchant, the amount if the code carries one, and any warnings worth showing the payer."
          />
          <Step
            n="2"
            title="Quote"
            body={`Price it. The winning route is signed and rate-locked for ${LIMITS.quoteTtlSeconds} seconds.`}
          />
          <Step
            n="3"
            title="Commit and fund"
            body="Create an intent from the quote, send the tokens to its deposit address, and watch it settle."
          />
        </div>
      </section>

      <section className="mb-16">
        <SectionTitle>Try it live</SectionTitle>
        <p className="mb-6 mt-3 max-w-2xl text-sm text-[var(--color-mist-500)]">
          These requests run against this deployment. Responses are real.
        </p>
        <Playground endpoints={ENDPOINTS} />
      </section>

      <section id="webhooks" className="mb-16 scroll-mt-24">
        <SectionTitle>Webhooks</SectionTitle>
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="panel p-6">
            <p className="text-sm font-semibold">Events</p>
            <ul className="mt-4 space-y-2.5 text-sm">
              {[
                ["payment_intent.created", "An intent was opened and is awaiting funds."],
                ["payment_intent.funded", "The payer's transfer was seen on chain."],
                ["payment_intent.succeeded", "Rupiah reached the merchant. Fulfil the order here."],
                ["payment_intent.failed", "Underpaid or otherwise unrecoverable."],
                ["payment_intent.expired", "No funds arrived inside the window."],
              ].map(([event, description]) => (
                <li key={event}>
                  <code className="num text-xs text-[var(--color-mint-300)]">{event}</code>
                  <p className="mt-0.5 text-xs text-[var(--color-mist-500)]">{description}</p>
                </li>
              ))}
            </ul>
            <p className="mt-5 border-t border-[var(--color-line)] pt-4 text-xs leading-relaxed text-[var(--color-mist-600)]">
              Delivery is retried five times over roughly ten minutes with exponential backoff. Any
              2xx marks it delivered.
            </p>
          </div>

          <div className="panel overflow-hidden">
            <div className="border-b border-[var(--color-line)] px-4 py-3">
              <p className="num text-[11px] text-[var(--color-mist-600)]">verify.ts</p>
            </div>
            <div className="scroll-x">
              <pre className="num p-4 text-[11px] leading-relaxed text-[var(--color-mist-300)]">
                {`import { createHmac, timingSafeEqual } from "node:crypto";

// Header: X-CryptoQu-Signature: t=<unix>,v1=<hex>
export function verify(body, header, secret) {
  const parts = Object.fromEntries(
    header.split(",").map((p) => p.split("=")),
  );
  const age = Math.abs(Date.now() / 1000 - Number(parts.t));
  if (!(age < 300)) return false; // reject replays

  const expected = createHmac("sha256", secret)
    .update(\`\${parts.t}.\${body}\`)
    .digest("hex");

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(parts.v1 ?? "", "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}`}
              </pre>
            </div>
          </div>
        </div>
      </section>

      <section className="mb-16">
        <SectionTitle>Errors</SectionTitle>
        <div className="panel scroll-x mt-6">
          <table className="table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Code</th>
                <th>Meaning</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["400", "missing_param", "A required field was absent or the wrong type."],
                ["401", "invalid_api_key", "The bearer token is unknown or revoked."],
                ["409", "quote_expired", "The rate lock lapsed — request a new quote."],
                ["409", "underpaid", "The transfer was smaller than the intent required."],
                ["422", "checksum", "The QRIS payload's tag-63 CRC does not match."],
                ["422", "missing_field", "The payload is valid TLV but not a usable QRIS code."],
                ["429", "rate_limited", "Too many requests. Back off and retry."],
              ].map(([status, code, meaning]) => (
                <tr key={code + status}>
                  <td className="num text-[var(--color-mist-100)]">{status}</td>
                  <td className="num text-[var(--color-flame-400)]">{code}</td>
                  <td>{meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <SectionTitle>Limits</SectionTitle>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <LimitCard label="Minimum" value={`Rp${LIMITS.minAmountIdr.toLocaleString("id-ID")}`} />
          <LimitCard
            label="Maximum"
            value={`Rp${LIMITS.maxAmountIdr.toLocaleString("id-ID")}`}
            note="Bank Indonesia QRIS ceiling"
          />
          <LimitCard label="Quote lock" value={`${LIMITS.quoteTtlSeconds}s`} />
          <LimitCard
            label="Peg tolerance"
            value={`${LIMITS.maxPegDeviationBps} bps`}
            note="Routes refuse beyond this"
          />
        </div>
      </section>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-2xl font-semibold tracking-tight">{children}</h2>;
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="panel-flat p-5">
      <span className="num text-xs text-[var(--color-flame-500)]">{n}</span>
      <p className="mt-2 font-semibold">{title}</p>
      <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-mist-500)]">{body}</p>
    </div>
  );
}

function LimitCard({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="panel-flat p-5">
      <p className="eyebrow">{label}</p>
      <p className="num mt-2 text-lg font-semibold text-[var(--color-mist-100)]">{value}</p>
      {note && <p className="mt-1 text-[11px] text-[var(--color-mist-600)]">{note}</p>}
    </div>
  );
}
