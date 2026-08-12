import type { Metadata } from "next";

import { StatusBoard } from "@/components/status/status-board";

export const metadata: Metadata = {
  title: "Status",
  description: "Live component health, FX oracle sources, stablecoin peg health and trial balance.",
};

export const dynamic = "force-dynamic";

export default function StatusPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-12 sm:py-16">
      <header className="mb-10 max-w-2xl">
        <p className="eyebrow">Status</p>
        <h1 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          What the system knows about itself
        </h1>
        <p className="mt-4 text-pretty text-sm leading-relaxed text-[var(--color-mist-500)]">
          The same checks the health endpoint runs before it agrees to quote: whether the books
          balance, whether the rate feeds answered, and whether every accepted token is still near
          its peg.
        </p>
      </header>

      <StatusBoard />
    </div>
  );
}
