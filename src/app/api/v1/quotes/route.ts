import { NextResponse } from "next/server";

import { handle, optionalNumber, optionalStringArray, readJson, requireString } from "@/server/http";
import { parseQris } from "@/lib/qris";
import {
  createQuote,
  type AssetSymbol,
  type ChainId,
  type Objective,
} from "@/lib/router";

export const dynamic = "force-dynamic";

const OBJECTIVES: Objective[] = ["cost", "speed", "balanced"];

/**
 * Prices a QRIS payment across every accepted asset and chain, returning the
 * winning route plus the runners-up and a signature that binds the numbers.
 */
export async function POST(request: Request) {
  return handle(request, { rateLimit: 120 }, async () => {
    const body = await readJson(request);
    const parsed = parseQris(requireString(body, "payload"));

    const objectiveInput = typeof body.objective === "string" ? body.objective : undefined;
    const objective = OBJECTIVES.includes(objectiveInput as Objective)
      ? (objectiveInput as Objective)
      : undefined;

    const quote = await createQuote({
      qris: parsed,
      amountIdr: optionalNumber(body, "amountIdr"),
      assets: optionalStringArray(body, "assets") as AssetSymbol[] | undefined,
      chains: optionalStringArray(body, "chains") as ChainId[] | undefined,
      objective,
    });

    return NextResponse.json(quote, { status: 201 });
  });
}
