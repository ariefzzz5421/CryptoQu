import { NextResponse } from "next/server";

import { handle } from "@/server/http";
import { listDeliveries } from "@/server/webhooks";
import { serialiseDelivery } from "@/server/serialise";

export const dynamic = "force-dynamic";

/** Every webhook CryptoQu attempted, with each delivery attempt and response. */
export async function GET(request: Request) {
  return handle(request, { rateLimit: 180 }, () => {
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 25);
    const deliveries = listDeliveries(Number.isFinite(limit) ? Math.min(limit, 100) : 25);
    return NextResponse.json({ data: deliveries.map(serialiseDelivery) });
  });
}
