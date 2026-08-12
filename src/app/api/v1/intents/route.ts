import { NextResponse } from "next/server";

import { ApiError, handle, readJson } from "@/server/http";
import { createIntent, listIntents } from "@/server/intents";
import { serialiseIntent } from "@/server/serialise";
import type { Quote } from "@/lib/router";

export const dynamic = "force-dynamic";

/** Commits a signed quote into a payment intent the payer can fund. */
export async function POST(request: Request) {
  return handle(request, { rateLimit: 120, idempotent: true }, async (context) => {
    const body = await readJson(request);
    const quote = body.quote as Quote | undefined;
    if (!quote || typeof quote !== "object" || !("signature" in quote)) {
      throw new ApiError(
        '"quote" is required and must be the object returned by POST /v1/quotes',
        "missing_param",
        400,
        "quote",
      );
    }

    const merchantId = typeof body.merchantId === "string" ? body.merchantId : context.merchantId;
    const intent = createIntent({ quote, merchantId });

    return NextResponse.json(serialiseIntent(intent), { status: 201 });
  });
}

/** Most recent intents, newest first. */
export async function GET(request: Request) {
  return handle(request, { rateLimit: 180 }, () => {
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 25);
    const intents = listIntents(Number.isFinite(limit) ? Math.min(limit, 100) : 25);
    return NextResponse.json({ data: intents.map(serialiseIntent) });
  });
}
