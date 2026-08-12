import type { Metadata } from "next";

import "./globals.css";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: {
    default: "CryptoQu — pay any QRIS merchant with stablecoins",
    template: "%s · CryptoQu",
  },
  description:
    "Payment infrastructure that lets anyone settle an Indonesian QRIS code with USDC, USDT or IDRX. The merchant receives rupiah on the rails they already use.",
  keywords: ["QRIS", "stablecoin", "USDC", "IDRX", "Indonesia", "payments", "crypto"],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="aurora" aria-hidden />
        <div className="page-grid" aria-hidden />
        <div className="shell flex min-h-screen flex-col">
          <SiteNav />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
