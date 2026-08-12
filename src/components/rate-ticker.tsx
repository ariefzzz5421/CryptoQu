"use client";

import { useEffect, useState } from "react";

import { formatRate } from "@/lib/format";

interface RatesResponse {
  rates: { base: string; rate: number; degraded: boolean; sources: { name: string }[] }[];
}

/** Live USD/IDR strip. Falls back quietly — a stale rate is better than a gap. */
export function RateTicker() {
  const [data, setData] = useState<RatesResponse["rates"] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/v1/rates", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as RatesResponse;
        if (!cancelled) setData(body.rates);
      } catch {
        // Leave the last known values on screen.
      }
    };
    void load();
    const timer = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const usd = data?.find((rate) => rate.base === "USD");

  return (
    <div className="inline-flex items-center gap-2.5 rounded-full border border-[var(--color-line-strong)] bg-[var(--color-ink-800)] px-3.5 py-1.5">
      <span className="live-dot" aria-hidden />
      <span className="num text-xs text-[var(--color-mist-300)]">
        USD/IDR{" "}
        <strong className="font-semibold text-[var(--color-mist-100)]">
          {usd ? formatRate(usd.rate) : "····"}
        </strong>
      </span>
      <span className="text-[10px] text-[var(--color-mist-600)]">
        {usd ? `${usd.sources.length} source${usd.sources.length === 1 ? "" : "s"}` : "loading"}
      </span>
    </div>
  );
}
