import { NextResponse } from "next/server";

import { handle, readJson, requireString } from "@/server/http";
import { computeTotalIdr, parseQris, resolveMdr } from "@/lib/qris";

/**
 * Decodes a QRIS payload into merchant identity, amounts and the raw TLV tree.
 * This is the first call in any payment flow.
 */
export async function POST(request: Request) {
  return handle(request, { rateLimit: 180 }, async () => {
    const body = await readJson(request);
    const payload = requireString(body, "payload");
    const enforceChecksum = body.enforceChecksum !== false;

    const parsed = parseQris(payload, { enforceChecksum });
    const total = computeTotalIdr(parsed);
    const mdr = resolveMdr(parsed.criteria, total || 0);

    return NextResponse.json({
      merchant: {
        name: parsed.merchantName,
        city: parsed.merchantCity,
        postalCode: parsed.postalCode,
        nmid: parsed.nmid,
        criteria: parsed.criteria,
        mcc: parsed.mcc,
        mccLabel: parsed.mccLabel,
        acquirers: parsed.accounts,
      },
      transaction: {
        dynamic: parsed.dynamic,
        currency: parsed.currency,
        countryCode: parsed.countryCode,
        amountIdr: parsed.amount,
        tip: parsed.tip,
        totalIdr: parsed.amount === undefined ? undefined : total,
      },
      settlement: {
        mdrBps: mdr.bps,
        mdrNote: mdr.note,
        bornBy: "merchant",
      },
      additionalData: parsed.additionalData,
      crc: parsed.crc,
      tlv: parsed.nodes,
      warnings: parsed.warnings,
    });
  });
}
