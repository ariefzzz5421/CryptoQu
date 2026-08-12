import type { Metadata } from "next";

import { MerchantConsole } from "@/components/merchant/console";
import { mintQris } from "@/lib/qris";

export const metadata: Metadata = {
  title: "Merchant console",
  description:
    "Generate dynamic QRIS codes, watch stablecoin settlements land in rupiah, and read the double-entry records behind every payment.",
};

export const dynamic = "force-dynamic";

/** The seeded demo merchant's counter code, minted through the real builder. */
const STATIC_QRIS = mintQris({
  merchantName: "Kopi Senja",
  merchantCity: "Bandung",
  nmid: "ID1024312341234",
  mcc: "5812",
  criteria: "UMI",
  storeLabel: "COUNTER-1",
});

export default function MerchantPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-12 sm:py-16">
      <header className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <p className="eyebrow">Merchant console</p>
          <h1 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Kopi Senja
          </h1>
          <p className="mt-4 text-pretty text-sm leading-relaxed text-[var(--color-mist-500)]">
            Bandung · micro enterprise · NMID ID1024312341234. Nothing here is stablecoin-aware from
            the merchant&apos;s side: they issue a QRIS code and rupiah arrives.
          </p>
        </div>
        <span className="badge badge-mint">sandbox</span>
      </header>

      <MerchantConsole staticQris={STATIC_QRIS} />
    </div>
  );
}
