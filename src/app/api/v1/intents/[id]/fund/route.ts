import { NextResponse } from "next/server";

import { handle, readJson, requireString } from "@/server/http";
import { fundIntent } from "@/server/intents";
import { serialiseIntent } from "@/server/serialise";

export const dynamic = "force-dynamic";

/**
 * Records the payer's on-chain transfer against an intent.
 *
 * In production the chain watcher calls this when it sees a transfer to the
 * intent's deposit address; exposing it directly lets an integration drive the
 * whole lifecycle without waiting on a real transaction.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handle(request, { rateLimit: 120, idempotent: true }, async () => {
    const body = await readJson(request);
    const intent = fundIntent(id, {
      txHash: requireString(body, "txHash"),
      amountMinor: typeof body.amountMinor === "string" ? body.amountMinor : undefined,
    });
    return NextResponse.json(serialiseIntent(intent), { status: 202 });
  });
}
