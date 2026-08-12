"use client";

import { useCallback, useEffect, useState } from "react";

import { QrCode } from "@/components/qr-code";
import { formatIdr, relativeTime, shortHash } from "@/lib/format";

interface IntentRow {
  id: string;
  status: string;
  reference: string;
  createdAt: string;
  amounts: { totalIdr: number; mdrIdr: number; merchantNetIdr: number };
  merchant: { name: string };
  payment: { asset: string; chain: string; amountIn: number; rail: string };
  funding?: { txHash: string };
}

interface LedgerResponse {
  balanced: boolean;
  trialBalance: Record<string, string>;
  accounts: { id: string; name: string; kind: string; currency: string; balance: string }[];
  transactions: {
    id: string;
    description: string;
    createdAt: string;
    postings: { account: string; amount: string; currency: string; direction: string }[];
  }[];
}

interface DeliveryRow {
  id: string;
  event: string;
  delivered: boolean;
  url?: string;
  createdAt: string;
  attempts: { status: number | null; error?: string }[];
}

type Tab = "invoice" | "payments" | "ledger" | "webhooks";

const TABS: { id: Tab; label: string }[] = [
  { id: "invoice", label: "New invoice" },
  { id: "payments", label: "Payments" },
  { id: "ledger", label: "Ledger" },
  { id: "webhooks", label: "Webhooks" },
];

export function MerchantConsole({ staticQris }: { staticQris: string }) {
  const [tab, setTab] = useState<Tab>("invoice");
  const [intents, setIntents] = useState<IntentRow[]>([]);
  const [ledger, setLedger] = useState<LedgerResponse | null>(null);
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);

  const refresh = useCallback(async () => {
    const load = async <T,>(url: string): Promise<T | null> => {
      try {
        const response = await fetch(url, { cache: "no-store" });
        return response.ok ? ((await response.json()) as T) : null;
      } catch {
        return null;
      }
    };

    const [intentsData, ledgerData, webhookData] = await Promise.all([
      load<{ data: IntentRow[] }>("/api/v1/intents?limit=25"),
      load<LedgerResponse>("/api/v1/ledger"),
      load<{ data: DeliveryRow[] }>("/api/v1/webhooks?limit=25"),
    ]);

    if (intentsData) setIntents(intentsData.data);
    if (ledgerData) setLedger(ledgerData);
    if (webhookData) setDeliveries(webhookData.data);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(refresh, 5_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const settled = intents.filter((intent) => intent.status === "succeeded");
  const grossIdr = settled.reduce((total, intent) => total + intent.amounts.totalIdr, 0);
  const netIdr = settled.reduce((total, intent) => total + intent.amounts.merchantNetIdr, 0);

  return (
    <div className="space-y-8">
      <div className="grid gap-px bg-[var(--color-line)] sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Settled payments" value={String(settled.length)} />
        <Kpi label="Gross volume" value={formatIdr(grossIdr)} />
        <Kpi label="Net of MDR" value={formatIdr(netIdr)} accent />
        <Kpi
          label="Books"
          value={ledger?.balanced ? "balanced" : ledger ? "off" : "…"}
          accent={ledger?.balanced}
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`rounded-lg px-3.5 py-2 text-sm transition-colors ${
              tab === item.id
                ? "bg-[var(--color-ink-700)] text-[var(--color-mist-100)]"
                : "text-[var(--color-mist-500)] hover:text-[var(--color-mist-100)]"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "invoice" && <InvoiceBuilder staticQris={staticQris} />}
      {tab === "payments" && <PaymentsTable intents={intents} />}
      {tab === "ledger" && <LedgerView ledger={ledger} />}
      {tab === "webhooks" && <WebhooksView deliveries={deliveries} />}
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-[var(--color-ink-900)] px-5 py-6">
      <p className="eyebrow">{label}</p>
      <p
        className={`num mt-2 text-xl font-semibold ${
          accent ? "text-[var(--color-mint-300)]" : "text-[var(--color-mist-100)]"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

/** Turns the merchant's reusable static code into a single-use one for a sale. */
function InvoiceBuilder({ staticQris }: { staticQris: string }) {
  const [amount, setAmount] = useState("45000");
  const [reference, setReference] = useState("");
  const [result, setResult] = useState<{ payload: string; amountIdr: number; referenceLabel?: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/qris/dynamic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          payload: staticQris,
          amountIdr: Number(amount),
          referenceLabel: reference || undefined,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.message ?? "could not build the code");
      setResult(json);
    } catch (err) {
      setError((err as Error).message);
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="panel p-6">
        <h2 className="text-lg font-semibold">Create a dynamic code</h2>
        <p className="mt-1.5 text-sm text-[var(--color-mist-500)]">
          Writes tag 54, flips the point-of-initiation to dynamic, and recomputes the CRC. The
          result is an ordinary QRIS code any Indonesian wallet will scan.
        </p>

        <label className="eyebrow mt-6 block" htmlFor="invoice-amount">
          Amount (IDR)
        </label>
        <input
          id="invoice-amount"
          className="input num mt-2"
          inputMode="numeric"
          value={amount}
          onChange={(event) => setAmount(event.target.value.replace(/[^\d]/g, ""))}
        />

        <label className="eyebrow mt-4 block" htmlFor="invoice-ref">
          Reference label (optional)
        </label>
        <input
          id="invoice-ref"
          className="input num mt-2"
          value={reference}
          maxLength={25}
          placeholder="INV-1042"
          onChange={(event) => setReference(event.target.value)}
        />
        <p className="mt-1.5 text-[11px] text-[var(--color-mist-600)]">
          Written to tag 62 sub-tag 05 — what the acquirer reconciles against.
        </p>

        <button
          type="button"
          className="btn btn-primary mt-6 w-full"
          disabled={busy || Number(amount) <= 0}
          onClick={create}
        >
          {busy ? "Building…" : "Generate code"}
        </button>

        {error && <p className="mt-4 text-sm text-[var(--color-rose-bad)]">{error}</p>}
      </div>

      <div className="panel flex flex-col items-center justify-center p-6">
        {result ? (
          <>
            <QrCode value={result.payload} size={216} />
            <p className="num mt-5 text-2xl font-semibold">{formatIdr(result.amountIdr)}</p>
            {result.referenceLabel && (
              <p className="num mt-1 text-xs text-[var(--color-mist-600)]">
                {result.referenceLabel}
              </p>
            )}
            <div className="scroll-x mt-5 w-full">
              <p className="num break-all rounded-lg border border-[var(--color-line)] bg-[var(--color-ink-900)] p-3 text-[10px] leading-relaxed text-[var(--color-mist-500)]">
                {result.payload}
              </p>
            </div>
          </>
        ) : (
          <div className="text-center">
            <QrCode value={staticQris} size={180} className="opacity-30" />
            <p className="mt-5 text-sm text-[var(--color-mist-500)]">
              Your static counter code. Generate an amount to make it single-use.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function PaymentsTable({ intents }: { intents: IntentRow[] }) {
  if (intents.length === 0) {
    return <Empty message="No payments yet. Run one from the checkout and it will appear here." />;
  }

  return (
    <div className="panel scroll-x">
      <table className="table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Reference</th>
            <th>Paid with</th>
            <th className="text-right">Gross</th>
            <th className="text-right">MDR</th>
            <th className="text-right">Net</th>
            <th>Tx</th>
            <th className="text-right">When</th>
          </tr>
        </thead>
        <tbody>
          {intents.map((intent) => (
            <tr key={intent.id}>
              <td>
                <span className={`badge ${statusTone(intent.status)}`}>{intent.status}</span>
              </td>
              <td className="num">{intent.reference}</td>
              <td className="num">
                {intent.payment.amountIn} {intent.payment.asset}
                <span className="ml-1.5 text-[var(--color-mist-600)]">{intent.payment.chain}</span>
              </td>
              <td className="num text-right">{formatIdr(intent.amounts.totalIdr)}</td>
              <td className="num text-right text-[var(--color-mist-600)]">
                −{formatIdr(intent.amounts.mdrIdr)}
              </td>
              <td className="num text-right text-[var(--color-mint-300)]">
                {formatIdr(intent.amounts.merchantNetIdr)}
              </td>
              <td className="num text-[var(--color-mist-600)]">
                {intent.funding ? shortHash(intent.funding.txHash, 6, 4) : "—"}
              </td>
              <td className="num text-right text-[var(--color-mist-600)]">
                {relativeTime(intent.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LedgerView({ ledger }: { ledger: LedgerResponse | null }) {
  if (!ledger) return <Empty message="Loading the books…" />;

  return (
    <div className="space-y-6">
      <div className="panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold">Trial balance</p>
          <span className={`badge ${ledger.balanced ? "badge-mint" : "badge-bad"}`}>
            {ledger.balanced ? "zero in every currency" : "unbalanced"}
          </span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {Object.entries(ledger.trialBalance).map(([currency, total]) => (
            <span key={currency} className="badge num">
              {currency} {total}
            </span>
          ))}
        </div>
      </div>

      {ledger.accounts.length > 0 && (
        <div className="panel scroll-x">
          <table className="table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Kind</th>
                <th className="text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {ledger.accounts.map((account) => (
                <tr key={account.id}>
                  <td>
                    <p className="text-[var(--color-mist-100)]">{account.name}</p>
                    <p className="num text-[11px] text-[var(--color-mist-600)]">{account.id}</p>
                  </td>
                  <td className="num">{account.kind}</td>
                  <td className="num text-right">
                    {account.balance} {account.currency}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {ledger.transactions.length === 0 ? (
        <Empty message="No postings yet — settle a payment to write the first entries." />
      ) : (
        <div className="space-y-3">
          {ledger.transactions.map((transaction) => (
            <div key={transaction.id} className="panel-flat p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-[var(--color-mist-100)]">{transaction.description}</p>
                <p className="num text-[11px] text-[var(--color-mist-600)]">
                  {relativeTime(transaction.createdAt)}
                </p>
              </div>
              <div className="mt-3 space-y-1.5">
                {transaction.postings.map((posting, index) => (
                  <div
                    key={`${transaction.id}-${index}`}
                    className="flex items-center justify-between gap-3 text-xs"
                  >
                    <span className="num truncate text-[var(--color-mist-600)]">
                      {posting.account}
                    </span>
                    <span
                      className={`num shrink-0 ${
                        posting.direction === "debit"
                          ? "text-[var(--color-mint-300)]"
                          : "text-[var(--color-flame-400)]"
                      }`}
                    >
                      {posting.amount} {posting.currency}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WebhooksView({ deliveries }: { deliveries: DeliveryRow[] }) {
  if (deliveries.length === 0) {
    return <Empty message="No events yet. They are emitted as intents move through settlement." />;
  }

  return (
    <div className="space-y-3">
      {deliveries.map((delivery) => (
        <div key={delivery.id} className="panel-flat p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="num text-sm text-[var(--color-mist-100)]">{delivery.event}</span>
              <span
                className={`badge ${
                  delivery.delivered
                    ? "badge-mint"
                    : delivery.url
                      ? "badge-warn"
                      : ""
                }`}
              >
                {delivery.delivered ? "delivered" : delivery.url ? "retrying" : "no endpoint set"}
              </span>
            </div>
            <span className="num text-[11px] text-[var(--color-mist-600)]">
              {relativeTime(delivery.createdAt)}
            </span>
          </div>
          {delivery.attempts.length > 0 && (
            <p className="num mt-2 text-[11px] text-[var(--color-mist-600)]">
              {delivery.attempts.length} attempt
              {delivery.attempts.length === 1 ? "" : "s"} · last{" "}
              {delivery.attempts[delivery.attempts.length - 1].status ??
                delivery.attempts[delivery.attempts.length - 1].error}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function Empty({ message }: { message: string }) {
  return (
    <div className="panel p-10 text-center text-sm text-[var(--color-mist-500)]">{message}</div>
  );
}

function statusTone(status: string): string {
  if (status === "succeeded") return "badge-mint";
  if (status === "failed" || status === "expired") return "badge-bad";
  if (status === "requires_payment") return "";
  return "badge-warn";
}
