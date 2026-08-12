"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { QrCode } from "@/components/qr-code";
import { Scanner, decodeImageFile } from "./scanner";
import { formatBps, formatDuration, formatIdr, formatRate, formatToken, shortHash } from "@/lib/format";
import type { DemoMerchant } from "@/lib/demo";
import type { Objective, Quote, Route } from "@/lib/router";

type Stage = "input" | "review" | "fund" | "done";

interface DecodedResponse {
  merchant: {
    name: string;
    city: string;
    nmid?: string;
    criteria?: string;
    mcc?: string;
    mccLabel: string;
    acquirers: { acquirer: string; guid: string }[];
  };
  transaction: { dynamic: boolean; amountIdr?: number; totalIdr?: number; currency: string };
  settlement: { mdrBps: number; mdrNote: string };
  warnings: string[];
}

interface IntentResponse {
  id: string;
  status: string;
  reference: string;
  depositAddress: string;
  expiresAt: string;
  amounts: Quote["amounts"];
  payment: {
    asset: string;
    chain: string;
    amountIn: number;
    amountInMinor: string;
    venue: string;
    rail: string;
    etaSeconds: number;
  };
  events: { at: string; status: string; message: string }[];
  funding?: { txHash: string };
}

const OBJECTIVES: { id: Objective; label: string; hint: string }[] = [
  { id: "cost", label: "Cheapest", hint: "Lowest all-in cost" },
  { id: "balanced", label: "Balanced", hint: "Default" },
  { id: "speed", label: "Fastest", hint: "Shortest settlement" },
];

export function Checkout({ demoCodes }: { demoCodes: DemoMerchant[] }) {
  const [stage, setStage] = useState<Stage>("input");
  const [payload, setPayload] = useState("");
  const [decoded, setDecoded] = useState<DecodedResponse | null>(null);
  const [amount, setAmount] = useState("");
  const [objective, setObjective] = useState<Objective>("balanced");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [intent, setIntent] = useState<IntentResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const call = useCallback(async <T,>(url: string, body?: unknown, method = "POST"): Promise<T> => {
    const response = await fetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const json = await response.json();
    if (!response.ok) throw new Error(json?.error?.message ?? `request failed (${response.status})`);
    return json as T;
  }, []);

  const decode = useCallback(
    async (input: string) => {
      setError(null);
      setBusy("decode");
      try {
        const result = await call<DecodedResponse>("/api/v1/qris/decode", { payload: input });
        setDecoded(result);
        setPayload(input);
        setAmount(result.transaction.amountIdr ? String(result.transaction.amountIdr) : "");
        setQuote(null);
        setIntent(null);
        setStage("review");
      } catch (err) {
        setDecoded(null);
        setError((err as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [call],
  );

  const requestQuote = useCallback(async () => {
    if (!decoded) return;
    setError(null);
    setBusy("quote");
    try {
      const parsedAmount = Number(amount);
      const result = await call<Quote>("/api/v1/quotes", {
        payload,
        amountIdr: decoded.transaction.dynamic ? undefined : parsedAmount,
        objective,
      });
      setQuote(result);
    } catch (err) {
      setQuote(null);
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }, [amount, call, decoded, objective, payload]);

  const commit = useCallback(
    async (route?: Route) => {
      if (!quote) return;
      setError(null);
      setBusy("intent");
      try {
        // Selecting an alternative re-quotes so the signature covers the route
        // that will actually be funded — a client cannot swap it locally.
        let committed = quote;
        if (route && route.id !== quote.route.id) {
          committed = await call<Quote>("/api/v1/quotes", {
            payload,
            amountIdr: decoded?.transaction.dynamic ? undefined : Number(amount),
            objective,
            assets: [route.asset],
            chains: [route.chain],
          });
          setQuote(committed);
        }
        const result = await call<IntentResponse>("/api/v1/intents", {
          quote: committed,
          merchantId: "mch_demo_kopisenja",
        });
        setIntent(result);
        setStage("fund");
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [amount, call, decoded, objective, payload, quote],
  );

  const simulateTransfer = useCallback(async () => {
    if (!intent) return;
    setError(null);
    setBusy("fund");
    try {
      const txHash = `0x${Array.from({ length: 64 }, () =>
        Math.floor(Math.random() * 16).toString(16),
      ).join("")}`;
      const result = await call<IntentResponse>(`/api/v1/intents/${intent.id}/fund`, { txHash });
      setIntent(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }, [call, intent]);

  // Poll while an intent is in flight so the timeline moves on its own.
  useEffect(() => {
    if (!intent || !intent.funding) return;
    if (["succeeded", "failed", "expired"].includes(intent.status)) {
      if (intent.status === "succeeded") setStage("done");
      return;
    }
    const timer = setInterval(async () => {
      try {
        const result = await call<IntentResponse>(`/api/v1/intents/${intent.id}`, undefined, "GET");
        setIntent(result);
      } catch {
        // Transient failures resolve on the next tick.
      }
    }, 1_200);
    return () => clearInterval(timer);
  }, [call, intent]);

  const reset = () => {
    setStage("input");
    setPayload("");
    setDecoded(null);
    setQuote(null);
    setIntent(null);
    setAmount("");
    setError(null);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
      <div className="space-y-6">
        <StageBar stage={stage} />

        {error && (
          <div className="panel-flat border-[rgba(255,92,122,0.4)] p-4 text-sm text-[var(--color-rose-bad)]">
            {error}
          </div>
        )}

        {stage === "input" && (
          <InputStage
            payload={payload}
            setPayload={setPayload}
            demoCodes={demoCodes}
            busy={busy === "decode"}
            onDecode={decode}
            showScanner={showScanner}
            setShowScanner={setShowScanner}
            fileRef={fileRef}
            onError={setError}
          />
        )}

        {stage !== "input" && decoded && (
          <MerchantCard decoded={decoded} payload={payload} onChange={reset} />
        )}

        {stage === "review" && decoded && (
          <ReviewStage
            decoded={decoded}
            amount={amount}
            setAmount={setAmount}
            objective={objective}
            setObjective={setObjective}
            quote={quote}
            busy={busy}
            onQuote={requestQuote}
            onCommit={commit}
          />
        )}

        {(stage === "fund" || stage === "done") && intent && (
          <FundStage
            intent={intent}
            busy={busy === "fund"}
            onSimulate={simulateTransfer}
            onReset={reset}
          />
        )}
      </div>

      <aside className="space-y-6">
        {quote ? <QuotePanel quote={quote} /> : <EmptyQuotePanel />}
      </aside>
    </div>
  );
}

function StageBar({ stage }: { stage: Stage }) {
  const steps: { id: Stage; label: string }[] = [
    { id: "input", label: "Scan" },
    { id: "review", label: "Route" },
    { id: "fund", label: "Pay" },
    { id: "done", label: "Settled" },
  ];
  const index = steps.findIndex((step) => step.id === stage);

  return (
    <ol className="flex items-center gap-2">
      {steps.map((step, i) => (
        <li key={step.id} className="flex flex-1 items-center gap-2">
          <div className="flex items-center gap-2">
            <span
              className={`num flex h-6 w-6 items-center justify-center rounded-full text-[11px] ${
                i <= index
                  ? "bg-[var(--color-mint-400)] text-[#04120e]"
                  : "border border-[var(--color-line-strong)] text-[var(--color-mist-600)]"
              }`}
            >
              {i + 1}
            </span>
            <span
              className={`text-xs ${
                i <= index ? "text-[var(--color-mist-100)]" : "text-[var(--color-mist-600)]"
              }`}
            >
              {step.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <span
              className={`h-px flex-1 ${
                i < index ? "bg-[var(--color-mint-500)]" : "bg-[var(--color-line)]"
              }`}
            />
          )}
        </li>
      ))}
    </ol>
  );
}

function InputStage({
  payload,
  setPayload,
  demoCodes,
  busy,
  onDecode,
  showScanner,
  setShowScanner,
  fileRef,
  onError,
}: {
  payload: string;
  setPayload: (value: string) => void;
  demoCodes: DemoMerchant[];
  busy: boolean;
  onDecode: (payload: string) => void;
  showScanner: boolean;
  setShowScanner: (value: boolean) => void;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onError: (message: string) => void;
}) {
  if (showScanner) {
    return (
      <Scanner
        onDetected={(value) => {
          setShowScanner(false);
          onDecode(value);
        }}
        onClose={() => setShowScanner(false)}
      />
    );
  }

  return (
    <div className="panel p-6">
      <h2 className="text-lg font-semibold">Point at a QRIS code</h2>
      <p className="mt-1.5 text-sm text-[var(--color-mist-500)]">
        Scan it, upload a photo, or paste the raw payload. Everything is parsed against the EMVCo
        spec, checksum included.
      </p>

      <div className="mt-5 flex flex-wrap gap-2.5">
        <button type="button" className="btn btn-mint" onClick={() => setShowScanner(true)}>
          Open camera
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
          Upload image
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            try {
              onDecode(await decodeImageFile(file));
            } catch (err) {
              onError((err as Error).message);
            }
          }}
        />
      </div>

      <label className="eyebrow mt-7 block" htmlFor="qris-payload">
        Or paste the payload
      </label>
      <textarea
        id="qris-payload"
        className="textarea mt-2 h-28"
        placeholder="00020101021126…6304ABCD"
        value={payload}
        onChange={(event) => setPayload(event.target.value)}
        spellCheck={false}
      />

      <button
        type="button"
        className="btn btn-primary mt-4 w-full"
        disabled={!payload.trim() || busy}
        onClick={() => onDecode(payload)}
      >
        {busy ? "Decoding…" : "Decode code"}
      </button>

      <div className="mt-7 border-t border-[var(--color-line)] pt-5">
        <p className="eyebrow mb-3">Sample merchants</p>
        <div className="space-y-2">
          {demoCodes.map((demo) => (
            <button
              key={demo.key}
              type="button"
              onClick={() => {
                setPayload(demo.payload);
                onDecode(demo.payload);
              }}
              className="panel-flat w-full px-4 py-3 text-left transition-colors hover:border-[var(--color-line-strong)]"
            >
              <p className="text-sm font-medium text-[var(--color-mist-100)]">{demo.label}</p>
              <p className="mt-0.5 text-xs text-[var(--color-mist-600)]">{demo.description}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function MerchantCard({
  decoded,
  payload,
  onChange,
}: {
  decoded: DecodedResponse;
  payload: string;
  onChange: () => void;
}) {
  return (
    <div className="panel p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <QrCode value={payload} size={78} />
          <div className="min-w-0">
            <p className="eyebrow">Merchant</p>
            <p className="mt-1 truncate text-lg font-semibold">{decoded.merchant.name}</p>
            <p className="text-xs text-[var(--color-mist-600)]">
              {decoded.merchant.city} · {decoded.merchant.mccLabel}
            </p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <span className="badge">{decoded.transaction.dynamic ? "Dynamic" : "Static"}</span>
              {decoded.merchant.criteria && (
                <span className="badge badge-mint">{decoded.merchant.criteria}</span>
              )}
              {decoded.merchant.nmid && (
                <span className="badge num">{decoded.merchant.nmid}</span>
              )}
            </div>
          </div>
        </div>
        <button type="button" onClick={onChange} className="btn btn-ghost px-3 py-1 text-xs">
          Change
        </button>
      </div>

      {decoded.warnings.length > 0 && (
        <ul className="mt-4 space-y-1 border-t border-[var(--color-line)] pt-4">
          {decoded.warnings.map((warning) => (
            <li key={warning} className="text-xs text-[var(--color-amber-warn)]">
              {warning}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReviewStage({
  decoded,
  amount,
  setAmount,
  objective,
  setObjective,
  quote,
  busy,
  onQuote,
  onCommit,
}: {
  decoded: DecodedResponse;
  amount: string;
  setAmount: (value: string) => void;
  objective: Objective;
  setObjective: (value: Objective) => void;
  quote: Quote | null;
  busy: string | null;
  onQuote: () => void;
  onCommit: (route?: Route) => void;
}) {
  const locked = decoded.transaction.dynamic;

  return (
    <div className="panel p-6">
      <h2 className="text-lg font-semibold">Amount and routing</h2>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <div>
          <label className="eyebrow mb-2 block" htmlFor="amount">
            Amount (IDR)
          </label>
          <input
            id="amount"
            className="input num"
            inputMode="numeric"
            value={amount}
            disabled={locked}
            onChange={(event) => setAmount(event.target.value.replace(/[^\d]/g, ""))}
            placeholder="45000"
          />
          <p className="mt-1.5 text-[11px] text-[var(--color-mist-600)]">
            {locked
              ? "Fixed by the merchant in tag 54 — it cannot be overridden."
              : "This code carries no amount, so you set it."}
          </p>
        </div>

        <div>
          <span className="eyebrow mb-2 block">Optimise for</span>
          <div className="grid grid-cols-3 gap-1.5">
            {OBJECTIVES.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setObjective(option.id)}
                title={option.hint}
                className={`rounded-lg border px-2 py-2 text-xs transition-colors ${
                  objective === option.id
                    ? "border-[var(--color-mint-400)] bg-[rgba(0,229,176,0.1)] text-[var(--color-mint-300)]"
                    : "border-[var(--color-line-strong)] text-[var(--color-mist-500)] hover:text-[var(--color-mist-100)]"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <button
        type="button"
        className="btn btn-primary mt-6 w-full"
        disabled={busy !== null || (!locked && Number(amount) <= 0)}
        onClick={onQuote}
      >
        {busy === "quote" ? "Pricing every route…" : quote ? "Re-price" : "Get a quote"}
      </button>

      {quote && (
        <div className="mt-7 border-t border-[var(--color-line)] pt-6">
          <p className="eyebrow mb-3">Other routes</p>
          <div className="space-y-2">
            {[quote.route, ...quote.alternatives].map((route, index) => (
              <RouteRow
                key={route.id}
                route={route}
                best={index === 0}
                disabled={busy !== null}
                onSelect={() => onCommit(route)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RouteRow({
  route,
  best,
  disabled,
  onSelect,
}: {
  route: Route;
  best: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors disabled:opacity-50 ${
        best
          ? "border-[var(--color-mint-400)] bg-[rgba(0,229,176,0.07)]"
          : "border-[var(--color-line)] hover:border-[var(--color-line-strong)]"
      }`}
    >
      <div className="min-w-0">
        <p className="num truncate text-sm text-[var(--color-mist-100)]">
          {formatToken(route.amountIn, route.asset, 6)}
        </p>
        <p className="truncate text-[11px] text-[var(--color-mist-600)]">
          {route.chain} · {route.venue.name}
        </p>
      </div>
      <div className="shrink-0 text-right">
        {best && <span className="badge badge-mint mb-1">Best</span>}
        <p className="num text-xs text-[var(--color-mist-300)]">{formatBps(route.costs.totalBps)}</p>
        <p className="num text-[11px] text-[var(--color-mist-600)]">
          {formatDuration(route.etaSeconds)}
        </p>
      </div>
    </button>
  );
}

function FundStage({
  intent,
  busy,
  onSimulate,
  onReset,
}: {
  intent: IntentResponse;
  busy: boolean;
  onSimulate: () => void;
  onReset: () => void;
}) {
  const settled = intent.status === "succeeded";
  const failed = intent.status === "failed" || intent.status === "expired";

  return (
    <div className="panel p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">
            {settled ? "Payment settled" : failed ? "Payment stopped" : "Send the transfer"}
          </h2>
          <p className="num mt-1 text-xs text-[var(--color-mist-600)]">
            {intent.id} · ref {intent.reference}
          </p>
        </div>
        <span
          className={`badge ${
            settled ? "badge-mint" : failed ? "badge-bad" : "badge-warn"
          }`}
        >
          {intent.status}
        </span>
      </div>

      {!intent.funding && (
        <div className="mt-6 flex flex-col gap-5 sm:flex-row sm:items-center">
          <QrCode value={intent.depositAddress} size={140} />
          <div className="min-w-0 flex-1">
            <p className="eyebrow">Send exactly</p>
            <p className="num mt-1 text-2xl font-semibold text-[var(--color-mint-300)]">
              {formatToken(intent.payment.amountIn, intent.payment.asset, 6)}
            </p>
            <p className="mt-1 text-xs text-[var(--color-mist-600)]">
              on {intent.payment.chain}, to
            </p>
            <p className="num mt-1.5 break-all rounded-lg border border-[var(--color-line)] bg-[var(--color-ink-900)] px-3 py-2 text-[11px] text-[var(--color-mist-300)]">
              {intent.depositAddress}
            </p>
          </div>
        </div>
      )}

      <ol className="mt-6 space-y-3 border-t border-[var(--color-line)] pt-5">
        {intent.events.map((event, index) => {
          const failed = event.status === "failed" || event.status === "expired";
          // Every event in the list has already happened, so only the last one
          // is "current" — the rest are done and should read that way.
          const current = index === intent.events.length - 1;
          return (
          <li key={`${event.at}-${event.status}`} className="flex items-start gap-3">
            <span
              className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                failed
                  ? "bg-[var(--color-rose-bad)]"
                  : current
                    ? "bg-[var(--color-mint-400)]"
                    : "bg-[var(--color-mint-500)] opacity-70"
              }`}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-[var(--color-mist-300)]">{event.message}</p>
              <p className="num text-[11px] text-[var(--color-mist-600)]">
                {new Date(event.at).toLocaleTimeString()}
              </p>
            </div>
          </li>
          );
        })}
      </ol>

      {intent.funding && !settled && !failed && (
        <p className="num mt-5 flex items-center gap-2 text-xs text-[var(--color-mist-500)]">
          <span className="live-dot" aria-hidden />
          {shortHash(intent.funding.txHash)} · settling in ~
          {formatDuration(intent.payment.etaSeconds)}
        </p>
      )}

      <div className="mt-6 flex flex-wrap gap-2.5">
        {!intent.funding && (
          <button type="button" className="btn btn-mint" disabled={busy} onClick={onSimulate}>
            {busy ? "Broadcasting…" : "Simulate the transfer"}
          </button>
        )}
        {(settled || failed) && (
          <button type="button" className="btn btn-primary" onClick={onReset}>
            Pay another code
          </button>
        )}
        <a
          href={`/api/v1/ledger?reference=${intent.id}`}
          target="_blank"
          rel="noreferrer"
          className="btn btn-ghost"
        >
          View ledger entries
        </a>
      </div>
    </div>
  );
}

function QuotePanel({ quote }: { quote: Quote }) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.round((quote.expiresAt - Date.now()) / 1000)),
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setRemaining(Math.max(0, Math.round((quote.expiresAt - Date.now()) / 1000)));
    }, 1_000);
    return () => clearInterval(timer);
  }, [quote.expiresAt]);

  const route = quote.route;
  const usdIdr = useMemo(() => quote.rates?.USD?.rate ?? 0, [quote.rates]);

  return (
    <div className="panel sticky top-24 overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--color-line)] px-5 py-3.5">
        <span className="text-sm font-semibold">Quote</span>
        <span className={`badge ${remaining > 15 ? "badge-mint" : "badge-warn"}`}>
          {remaining > 0 ? `locked ${remaining}s` : "expired"}
        </span>
      </div>

      <div className="space-y-3.5 px-5 py-5">
        <Line label="Merchant receives" value={formatIdr(quote.amounts.totalIdr)} strong />
        {quote.amounts.tipIdr > 0 && (
          <Line label="of which convenience fee" value={formatIdr(quote.amounts.tipIdr)} muted />
        )}
        <Line
          label="You send"
          value={formatToken(route.amountIn, route.asset, 6)}
          accent
          strong
        />
        <Line label="Network" value={`${route.chain} · ${route.rail.name}`} />
        <Line label="Via" value={route.venue.name} />
        <Line label="Settles in" value={`~${formatDuration(route.etaSeconds)}`} />
      </div>

      <div className="border-t border-[var(--color-line)] px-5 py-5">
        <p className="eyebrow mb-3">Cost breakdown</p>
        <div className="space-y-2.5">
          <Line label="Platform fee" value={formatBps(route.costs.platformFeeBps)} muted />
          <Line label="FX spread" value={formatBps(route.costs.fxSpreadBps)} muted />
          <Line label="Venue fee" value={formatBps(route.costs.venueFeeBps)} muted />
          <Line label="Depth impact" value={formatBps(route.costs.priceImpactBps)} muted />
          <Line label="Gas" value={`$${route.costs.networkFeeUsd.toFixed(4)}`} muted />
          <div className="hairline pt-2.5">
            <Line
              label="All-in"
              value={`${formatBps(route.costs.totalBps)} · ${formatIdr(route.costs.totalCostIdr)}`}
              strong
            />
          </div>
        </div>
      </div>

      <div className="border-t border-[var(--color-line)] px-5 py-5">
        <p className="eyebrow mb-3">Rates</p>
        <div className="space-y-2.5">
          <Line label="Mid-market" value={`${formatRate(route.referenceRate)} IDR`} muted />
          <Line label="Your rate" value={`${formatRate(route.effectiveRate)} IDR`} muted />
          {usdIdr > 0 && <Line label="USD/IDR" value={formatRate(usdIdr)} muted />}
        </div>
      </div>

      <div className="border-t border-[var(--color-line)] px-5 py-5">
        <p className="eyebrow mb-3">Merchant settlement</p>
        <div className="space-y-2.5">
          <Line label={`MDR (${formatBps(quote.amounts.mdrBps)})`} value={formatIdr(quote.amounts.mdrIdr)} muted />
          <Line label="Net to merchant" value={formatIdr(quote.amounts.merchantNetIdr)} />
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-[var(--color-mist-600)]">
          {quote.amounts.mdrNote}. Bank Indonesia requires the merchant to bear this, so it is not
          added to what you pay.
        </p>
      </div>

      {quote.warnings.length > 0 && (
        <ul className="space-y-1.5 border-t border-[var(--color-line)] px-5 py-4">
          {quote.warnings.map((warning) => (
            <li key={warning} className="text-[11px] text-[var(--color-amber-warn)]">
              {warning}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyQuotePanel() {
  return (
    <div className="panel sticky top-24 p-6">
      <p className="text-sm font-semibold">No quote yet</p>
      <p className="mt-2 text-sm leading-relaxed text-[var(--color-mist-500)]">
        Decode a code and set an amount. Every accepted asset and chain gets priced end to end, and
        the winning route is signed with a 90-second rate lock.
      </p>
      <ul className="mt-5 space-y-2.5 text-xs text-[var(--color-mist-600)]">
        <li>· Gas, venue fee, depth impact and FX spread, itemised</li>
        <li>· Merchant discount rate shown but never charged to you</li>
        <li>· Ledger entries readable for every settled payment</li>
      </ul>
    </div>
  );
}

function Line({
  label,
  value,
  strong,
  accent,
  muted,
}: {
  label: string;
  value: string;
  strong?: boolean;
  accent?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={`text-xs ${muted ? "text-[var(--color-mist-600)]" : "text-[var(--color-mist-500)]"}`}>
        {label}
      </span>
      <span
        className={`num shrink-0 text-right ${
          accent
            ? "text-[var(--color-mint-300)]"
            : strong
              ? "text-[var(--color-mist-100)]"
              : "text-[var(--color-mist-300)]"
        } ${strong ? "text-base font-semibold" : "text-sm"}`}
      >
        {value}
      </span>
    </div>
  );
}
