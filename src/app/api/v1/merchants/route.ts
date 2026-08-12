import { NextResponse } from "next/server";

import { ApiError, handle, readJson, requireString } from "@/server/http";
import { createMerchant, getStore, issueApiKey } from "@/server/store";
import { serialiseMerchant } from "@/server/serialise";
import { mintQris } from "@/lib/qris";

export const dynamic = "force-dynamic";

/**
 * Onboards a merchant: registers them, mints their static QRIS code, and
 * returns an API key. The key's plaintext appears in this response only.
 */
export async function POST(request: Request) {
  return handle(request, { rateLimit: 30, idempotent: true }, async () => {
    const body = await readJson(request);
    const payout = body.payout as Record<string, unknown> | undefined;
    if (!payout || typeof payout !== "object") {
      throw new ApiError(
        '"payout" is required — { bank, accountNumber, accountName }',
        "missing_param",
        400,
        "payout",
      );
    }

    const merchant = createMerchant({
      name: requireString(body, "name"),
      city: requireString(body, "city"),
      nmid: requireString(body, "nmid"),
      criteria: typeof body.criteria === "string" ? body.criteria : undefined,
      mcc: typeof body.mcc === "string" ? body.mcc : undefined,
      payout: {
        bank: requireString(payout, "bank"),
        accountNumber: requireString(payout, "accountNumber"),
        accountName: requireString(payout, "accountName"),
      },
      webhookUrl: typeof body.webhookUrl === "string" ? body.webhookUrl : undefined,
    });

    merchant.staticQris = mintQris({
      merchantName: merchant.name,
      merchantCity: merchant.city,
      nmid: merchant.nmid,
      mcc: merchant.mcc,
      criteria: merchant.criteria,
    });

    const { key, secret } = issueApiKey(merchant.id, "primary");

    return NextResponse.json(
      {
        ...serialiseMerchant(merchant),
        staticQris: merchant.staticQris,
        webhookSecret: merchant.webhookSecret,
        apiKey: { id: key.id, label: key.label, secret },
      },
      { status: 201 },
    );
  });
}

/** Lists registered merchants. */
export async function GET(request: Request) {
  return handle(request, { rateLimit: 120 }, () =>
    NextResponse.json({
      data: [...getStore().merchants.values()]
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(serialiseMerchant),
    }),
  );
}
