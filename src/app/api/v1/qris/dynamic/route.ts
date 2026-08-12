import { NextResponse } from "next/server";

import { ApiError, handle, optionalNumber, readJson, requireString } from "@/server/http";
import { parseQris, toDynamicQris } from "@/lib/qris";

/**
 * Promotes a merchant's reusable static code into a single-use dynamic one
 * carrying an amount — what a POS terminal shows a customer at checkout.
 */
export async function POST(request: Request) {
  return handle(request, { rateLimit: 180, idempotent: true }, async () => {
    const body = await readJson(request);
    const payload = requireString(body, "payload");
    const amountIdr = optionalNumber(body, "amountIdr");
    if (amountIdr === undefined) {
      throw new ApiError('"amountIdr" is required', "missing_param", 400, "amountIdr");
    }

    const source = parseQris(payload);
    const dynamicPayload = toDynamicQris(source, {
      amountIdr,
      feeFixedIdr: optionalNumber(body, "feeFixedIdr"),
      feePercent: optionalNumber(body, "feePercent"),
      billNumber: typeof body.billNumber === "string" ? body.billNumber : undefined,
      referenceLabel: typeof body.referenceLabel === "string" ? body.referenceLabel : undefined,
      terminalLabel: typeof body.terminalLabel === "string" ? body.terminalLabel : undefined,
      storeLabel: typeof body.storeLabel === "string" ? body.storeLabel : undefined,
    });

    const result = parseQris(dynamicPayload);

    return NextResponse.json(
      {
        payload: dynamicPayload,
        merchant: { name: result.merchantName, city: result.merchantCity, nmid: result.nmid },
        amountIdr: result.amount,
        tip: result.tip,
        referenceLabel: result.additionalData.referenceLabel,
        crc: result.crc,
        dynamic: result.dynamic,
      },
      { status: 201 },
    );
  });
}
