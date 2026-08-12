import { NextResponse } from "next/server";

import { handle } from "@/server/http";
import { ASSETS, getPegStatus, getRateSnapshot, type FiatCurrency } from "@/lib/router";

export const dynamic = "force-dynamic";

const CURRENCIES: FiatCurrency[] = ["USD", "EUR", "SGD", "IDR"];

/** Current IDR rates per peg currency, plus peg health for every accepted token. */
export async function GET(request: Request) {
  return handle(request, { rateLimit: 240 }, async () => {
    const snapshots = await Promise.all(CURRENCIES.map((currency) => getRateSnapshot(currency)));

    return NextResponse.json({
      quote: "IDR",
      rates: snapshots.map((snapshot) => ({
        base: snapshot.base,
        rate: snapshot.rate,
        dispersionBps: snapshot.dispersionBps,
        degraded: snapshot.degraded,
        asOf: new Date(snapshot.asOf).toISOString(),
        sources: snapshot.samples.map((sample) => ({
          name: sample.source,
          rate: sample.rate,
          live: sample.live,
        })),
      })),
      pegs: Object.values(ASSETS).map((asset) => ({
        ...getPegStatus(asset.symbol),
        pegCurrency: asset.pegCurrency,
      })),
    });
  });
}
