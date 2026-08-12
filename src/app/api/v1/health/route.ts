import { NextResponse } from "next/server";

import { handle } from "@/server/http";
import { getStore } from "@/server/store";
import { getRateSnapshot } from "@/lib/router";

export const dynamic = "force-dynamic";

/** Liveness plus the two things that actually decide whether we can quote. */
export async function GET(request: Request) {
  return handle(request, { rateLimit: 240 }, async () => {
    const store = getStore();
    const usd = await getRateSnapshot("USD");

    const components = {
      ledger: store.ledger.isBalanced() ? "ok" : "degraded",
      fxOracle: usd.degraded ? "degraded" : "ok",
      routing: "ok",
    } as const;

    const healthy = Object.values(components).every((value) => value === "ok");

    return NextResponse.json(
      {
        status: healthy ? "ok" : "degraded",
        version: "1.0.0",
        time: new Date().toISOString(),
        components,
        fx: {
          usdIdr: usd.rate,
          sources: usd.samples.map((sample) => sample.source),
          dispersionBps: usd.dispersionBps,
          asOf: new Date(usd.asOf).toISOString(),
        },
        counters: {
          merchants: store.merchants.size,
          intents: store.intents.size,
          ledgerTransactions: store.ledger.listTransactions(10_000).length,
        },
        trialBalance: store.ledger.trialBalance(),
      },
      { status: healthy ? 200 : 503 },
    );
  });
}
