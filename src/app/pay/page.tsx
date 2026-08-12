import type { Metadata } from "next";

import { Checkout } from "@/components/pay/checkout";
import { DEMO_CODES } from "@/lib/demo";

export const metadata: Metadata = {
  title: "Checkout",
  description:
    "Scan an Indonesian QRIS code and settle it with USDC, USDT or IDRX across Base, Solana, Polygon, Arbitrum, Lisk or Ethereum.",
};

export default function PayPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-12 sm:py-16">
      <header className="mb-10 max-w-2xl">
        <p className="eyebrow">Checkout</p>
        <h1 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          Scan a QRIS code, pay in stablecoins
        </h1>
        <p className="mt-4 text-pretty text-sm leading-relaxed text-[var(--color-mist-500)]">
          This runs the real codec, router and ledger. Codes are parsed against the EMVCo spec,
          routes are priced across every accepted asset and chain, and settled payments post
          double-entry records you can read back.
        </p>
      </header>

      <Checkout demoCodes={DEMO_CODES} />
    </div>
  );
}
