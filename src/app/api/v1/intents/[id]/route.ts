import { NextResponse } from "next/server";

import { handle } from "@/server/http";
import { getIntent } from "@/server/intents";
import { serialiseIntent } from "@/server/serialise";

export const dynamic = "force-dynamic";

/** Reads one intent. State is recomputed from its timeline on every read. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handle(request, { rateLimit: 300 }, () =>
    NextResponse.json(serialiseIntent(getIntent(id))),
  );
}
