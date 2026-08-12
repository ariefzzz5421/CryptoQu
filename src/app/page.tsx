import Link from "next/link";

import { ArchitectureDiagram } from "@/components/architecture-diagram";
import { QrCode } from "@/components/qr-code";
import { RateTicker } from "@/components/rate-ticker";
import { DEFAULT_DEMO } from "@/lib/demo";
import { ASSETS, CHAINS, LIMITS, PLATFORM_FEE_BPS } from "@/lib/router";
import { MDR_SCHEDULE } from "@/lib/qris";
import { formatBps, formatIdr } from "@/lib/format";

export default function HomePage() {
  return (
    <>
      <Hero />
      <Numbers />
      <HowItWorks />
      <Architecture />
      <Coverage />
      <Economics />
      <Developers />
      <Closing />
    </>
  );
}

function Hero() {
  return (
    <section className="mx-auto max-w-6xl px-5 pb-16 pt-16 sm:pt-24">
      <div className="grid items-center gap-12 lg:grid-cols-[1.15fr_1fr]">
        <div className="rise">
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <span className="badge badge-flame">QRIS × stablecoin</span>
            <RateTicker />
          </div>

          <h1 className="text-balance text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
            Pay any Indonesian QR code
            <br />
            <span className="gradient-text">with the stablecoins you already hold.</span>
          </h1>

          <p className="mt-6 max-w-xl text-pretty text-base leading-relaxed text-[var(--color-mist-300)] sm:text-lg">
            CryptoQu decodes the merchant&apos;s QRIS code, routes your USDC, USDT or IDRX across
            the cheapest chain and venue, and pays the merchant in rupiah on the rails they already
            settle on. The warung sees a normal QRIS payment. You never touch an exchange.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/pay" className="btn btn-primary">
              Scan a code →
            </Link>
            <Link href="/docs" className="btn btn-ghost">
              Read the API
            </Link>
          </div>

          <dl className="mt-10 grid max-w-lg grid-cols-3 gap-6">
            <HeroStat label="Settlement" value="~20s" detail="transfer to rupiah" />
            <HeroStat label="Payer cost" value={formatBps(PLATFORM_FEE_BPS + 15)} detail="typical all-in" />
            <HeroStat label="Merchant change" value="none" detail="same code, same rail" />
          </dl>
        </div>

        <CheckoutPreview />
      </div>
    </section>
  );
}

function HeroStat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="num mt-1.5 text-2xl font-semibold text-[var(--color-mist-100)]">{value}</dd>
      <dd className="mt-0.5 text-xs text-[var(--color-mist-600)]">{detail}</dd>
    </div>
  );
}

/** A static rendition of the checkout, using a real minted QRIS payload. */
function CheckoutPreview() {
  return (
    <div className="rise panel relative overflow-hidden p-6 sm:p-7">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--color-mint-400)] to-transparent opacity-50" />

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Merchant</p>
          <p className="mt-1 text-lg font-semibold">Kopi Senja</p>
          <p className="text-xs text-[var(--color-mist-600)]">Bandung · Restaurants &amp; warung makan</p>
        </div>
        <span className="badge badge-mint">UMI · 0% MDR</span>
      </div>

      <div className="mt-6 flex items-center gap-5">
        <div className="relative shrink-0">
          <QrCode value={DEFAULT_DEMO.payload} size={132} />
          <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
            <div className="scan-sweep h-8 w-full bg-gradient-to-b from-transparent via-[rgba(0,229,176,0.45)] to-transparent" />
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-2.5">
          <PreviewRow label="Amount" value={formatIdr(45_000)} strong />
          <PreviewRow label="You send" value="2.812104 USDC" accent />
          <PreviewRow label="Network" value="Base · 2 conf" />
          <PreviewRow label="Rate" value="16.010 IDR" />
        </div>
      </div>

      <div className="mt-6 space-y-2 border-t border-[var(--color-line)] pt-5">
        <TimelineRow label="Transfer seen" detail="4s" done />
        <TimelineRow label="Converted at Jakarta OTC desk" detail="8s" done />
        <TimelineRow label="Rp45.000 paid over BI-FAST" detail="12s" active />
      </div>
    </div>
  );
}

function PreviewRow({
  label,
  value,
  strong,
  accent,
}: {
  label: string;
  value: string;
  strong?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-[var(--color-mist-600)]">{label}</span>
      <span
        className={`num truncate text-sm ${
          accent
            ? "text-[var(--color-mint-300)]"
            : strong
              ? "text-lg font-semibold text-[var(--color-mist-100)]"
              : "text-[var(--color-mist-300)]"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function TimelineRow({
  label,
  detail,
  done,
  active,
}: {
  label: string;
  detail: string;
  done?: boolean;
  active?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          active
            ? "bg-[var(--color-mint-400)]"
            : done
              ? "bg-[var(--color-mint-500)]"
              : "bg-[var(--color-ink-500)]"
        }`}
      />
      <span className="flex-1 truncate text-xs text-[var(--color-mist-300)]">{label}</span>
      <span className="num text-[11px] text-[var(--color-mist-600)]">{detail}</span>
    </div>
  );
}

function Numbers() {
  const chainCount = Object.keys(CHAINS).length;
  const assetCount = Object.keys(ASSETS).length;

  return (
    <section className="hairline">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px bg-[var(--color-line)] px-5 lg:grid-cols-4">
        <Stat value={`${assetCount}`} label="Stablecoins accepted" />
        <Stat value={`${chainCount}`} label="Settlement networks" />
        <Stat value={formatIdr(LIMITS.maxAmountIdr, { compact: true })} label="Per-transaction ceiling" />
        <Stat value={`${LIMITS.quoteTtlSeconds}s`} label="Rate lock on every quote" />
      </div>
    </section>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="bg-[var(--color-ink-900)] px-2 py-8 text-center">
      <p className="num text-2xl font-semibold text-[var(--color-mist-100)] sm:text-3xl">{value}</p>
      <p className="mt-1.5 text-xs text-[var(--color-mist-600)]">{label}</p>
    </div>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: "01",
      title: "Decode",
      body: "The code is parsed as EMVCo TLV: merchant name, NMID, category, amount, convenience fee, and the CRC-16 that proves it was not edited on the way to your camera.",
      code: "POST /v1/qris/decode",
    },
    {
      n: "02",
      title: "Route",
      body: "Every accepted asset and chain is priced end to end — gas, venue fee, depth impact, FX spread — and ranked for cost or speed. The winning route is signed with a 90-second rate lock.",
      code: "POST /v1/quotes",
    },
    {
      n: "03",
      title: "Settle",
      body: "You send tokens once. The vault converts at the chosen venue, rupiah leaves over BI-FAST, and the merchant is credited against the same reference their acquirer reconciles on.",
      code: "POST /v1/intents",
    },
  ];

  return (
    <section className="mx-auto max-w-6xl px-5 py-20">
      <SectionHeading
        eyebrow="How it works"
        title="Three calls from camera to counter"
        blurb="The whole flow is a public API. Nothing about it requires the merchant to install anything, hold a token, or know a payment was funded on-chain."
      />

      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {steps.map((step) => (
          <div key={step.n} className="panel group p-6 transition-colors hover:border-[var(--color-line-strong)]">
            <span className="num text-xs text-[var(--color-flame-500)]">{step.n}</span>
            <h3 className="mt-3 text-lg font-semibold">{step.title}</h3>
            <p className="mt-2.5 text-sm leading-relaxed text-[var(--color-mist-500)]">{step.body}</p>
            <code className="num mt-5 block rounded-lg border border-[var(--color-line)] bg-[var(--color-ink-900)] px-3 py-2 text-[11px] text-[var(--color-mint-300)]">
              {step.code}
            </code>
          </div>
        ))}
      </div>
    </section>
  );
}

function Architecture() {
  return (
    <section className="hairline">
      <div className="mx-auto max-w-6xl px-5 py-20">
        <SectionHeading
          eyebrow="Architecture"
          title="Where the money actually goes"
          blurb="Built from the primitives up: a QRIS codec, a routing engine, a double-entry ledger and a webhook dispatcher. No black box between the payer's transfer and the merchant's account."
        />
        <div className="panel mt-12 p-6 sm:p-8">
          <ArchitectureDiagram />
        </div>
      </div>
    </section>
  );
}

function Coverage() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-20">
      <SectionHeading
        eyebrow="Coverage"
        title="Bring the token you have"
        blurb="Rupiah-pegged tokens skip the FX leg entirely; dollar-pegged ones cross once, at a median rate taken from independent feeds."
      />

      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Object.values(ASSETS).map((asset) => (
          <div key={asset.symbol} className="panel-flat p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span
                  className="h-7 w-7 shrink-0 rounded-full"
                  style={{ background: asset.accent }}
                  aria-hidden
                />
                <div>
                  <p className="text-sm font-semibold">{asset.symbol}</p>
                  <p className="text-[11px] text-[var(--color-mist-600)]">{asset.issuer}</p>
                </div>
              </div>
              <span className={`badge ${asset.pegCurrency === "IDR" ? "badge-mint" : ""}`}>
                {asset.pegCurrency}
              </span>
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {asset.chains.map((chainId) => (
                <span key={chainId} className="badge text-[10px]">
                  {CHAINS[chainId].name}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Economics() {
  return (
    <section className="hairline">
      <div className="mx-auto max-w-6xl px-5 py-20">
        <SectionHeading
          eyebrow="Economics"
          title="Priced in the open"
          blurb="Bank Indonesia sets the merchant discount rate and forbids passing it to the customer. CryptoQu's own take rate sits on the payer's side of the line, and every quote itemises it."
        />

        <div className="mt-12 grid gap-5 lg:grid-cols-2">
          <div className="panel overflow-hidden">
            <div className="border-b border-[var(--color-line)] px-6 py-4">
              <p className="text-sm font-semibold">Merchant side — MDR, borne by the merchant</p>
            </div>
            <div className="scroll-x">
              <table className="table">
                <thead>
                  <tr>
                    <th>Classification</th>
                    <th>Condition</th>
                    <th className="text-right">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {MDR_SCHEDULE.filter((tier) => tier.criteria !== "DEFAULT").map((tier) => (
                    <tr key={`${tier.criteria}-${tier.upToIdr ?? "all"}`}>
                      <td className="num text-[var(--color-mist-100)]">{tier.criteria}</td>
                      <td>{tier.note}</td>
                      <td className="num text-right text-[var(--color-mist-100)]">
                        {formatBps(tier.bps)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel p-6">
            <p className="text-sm font-semibold">Payer side — what CryptoQu charges</p>
            <ul className="mt-5 space-y-4">
              <CostRow
                label="Platform fee"
                value={formatBps(PLATFORM_FEE_BPS)}
                detail="Fixed. The only line that is ours."
              />
              <CostRow label="FX spread" value="0.15%" detail="USD→IDR. Zero on IDRX." />
              <CostRow label="Venue fee" value="0.00–0.20%" detail="Best of internal book, issuer, OTC, AMM." />
              <CostRow label="Depth impact" value="size-dependent" detail="Quoted, never estimated after the fact." />
              <CostRow label="Network gas" value="$0.0008–$1.85" detail="Paid to the chain, not to us." />
            </ul>
            <p className="mt-6 border-t border-[var(--color-line)] pt-5 text-xs leading-relaxed text-[var(--color-mist-600)]">
              A quote is signed and expires after {LIMITS.quoteTtlSeconds} seconds. If it lapses
              before you fund it, you get a new one — you are never settled at a rate you did not
              see.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function CostRow({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <li className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm text-[var(--color-mist-100)]">{label}</p>
        <p className="text-xs text-[var(--color-mist-600)]">{detail}</p>
      </div>
      <span className="num shrink-0 text-sm text-[var(--color-mint-300)]">{value}</span>
    </li>
  );
}

function Developers() {
  const sample = `# 1. Decode the merchant's code
curl -s https://cryptoqu.app/api/v1/qris/decode \\
  -H 'content-type: application/json' \\
  -d '{"payload":"00020101021151440014ID.CO.QRIS.WWW..."}'

# 2. Price it across every asset and chain
curl -s https://cryptoqu.app/api/v1/quotes \\
  -H 'content-type: application/json' \\
  -d '{"payload":"...","amountIdr":45000,"objective":"cost"}'

# 3. Commit the quote, then fund the intent on chain
curl -s https://cryptoqu.app/api/v1/intents \\
  -H 'content-type: application/json' \\
  -H 'idempotency-key: 7f3c…' \\
  -d '{"quote":{...}}'`;

  return (
    <section className="mx-auto max-w-6xl px-5 py-20">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <div>
          <SectionHeading
            eyebrow="Developers"
            title="An API, not a widget"
            blurb="Signed quotes, idempotency keys, HMAC webhooks with backoff, and a ledger endpoint that will show you its own trial balance. Everything the demo does, your integration can do."
            align="left"
          />
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/docs" className="btn btn-mint">
              API reference
            </Link>
            <Link href="/merchant" className="btn btn-ghost">
              Merchant console
            </Link>
          </div>
        </div>

        <div className="panel overflow-hidden">
          <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-4 py-3">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-flame-500)]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-amber-warn)]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-mint-400)]" />
            <span className="num ml-2 text-[11px] text-[var(--color-mist-600)]">checkout.sh</span>
          </div>
          <div className="scroll-x">
            <pre className="num p-5 text-[11.5px] leading-relaxed text-[var(--color-mist-300)]">
              {sample}
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}

function Closing() {
  return (
    <section className="mx-auto max-w-6xl px-5 pb-8">
      <div className="panel relative overflow-hidden px-6 py-14 text-center sm:px-12">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              "radial-gradient(30rem 14rem at 50% 0%, rgba(255,77,61,0.22), transparent 70%)",
          }}
          aria-hidden
        />
        <div className="relative">
          <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Try it against a real QRIS payload
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-pretty text-sm leading-relaxed text-[var(--color-mist-500)]">
            The checkout runs the actual codec, router and ledger. Paste any Indonesian QR code, or
            start from one of the sample merchants.
          </p>
          <Link href="/pay" className="btn btn-primary mt-8">
            Open the checkout →
          </Link>
        </div>
      </div>
    </section>
  );
}

function SectionHeading({
  eyebrow,
  title,
  blurb,
  align = "center",
}: {
  eyebrow: string;
  title: string;
  blurb: string;
  align?: "center" | "left";
}) {
  return (
    <div className={align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-xl"}>
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
      <p className="mt-4 text-pretty text-sm leading-relaxed text-[var(--color-mist-500)] sm:text-base">
        {blurb}
      </p>
    </div>
  );
}
