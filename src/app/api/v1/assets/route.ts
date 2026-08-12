import { NextResponse } from "next/server";

import { handle } from "@/server/http";
import { ASSETS, CHAINS, LIMITS, PLATFORM_FEE_BPS, SETTLEMENT_RAILS, VENUES } from "@/lib/router";
import { MDR_SCHEDULE, MERCHANT_CRITERIA } from "@/lib/qris";

/** The full acceptance surface: what can be paid, where, and under what limits. */
export async function GET(request: Request) {
  return handle(request, { rateLimit: 240 }, () =>
    NextResponse.json({
      assets: Object.values(ASSETS),
      chains: Object.values(CHAINS),
      venues: VENUES.map(({ id, name, kind, feeBps, depthUsd, latencySeconds, maxTicketUsd }) => ({
        id,
        name,
        kind,
        feeBps,
        depthUsd,
        latencySeconds,
        maxTicketUsd,
      })),
      settlementRails: SETTLEMENT_RAILS,
      limits: LIMITS,
      platformFeeBps: PLATFORM_FEE_BPS,
      merchantCriteria: MERCHANT_CRITERIA,
      mdrSchedule: MDR_SCHEDULE,
    }),
  );
}
