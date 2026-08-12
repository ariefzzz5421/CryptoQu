import Link from "next/link";

import { Logo } from "./logo";

export function SiteFooter() {
  return (
    <footer className="hairline mt-24">
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Logo size={26} />
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-[var(--color-mist-500)]">
            Stablecoin settlement for Indonesia&apos;s QR standard. The payer holds tokens, the
            merchant receives rupiah, and nothing at the counter has to change.
          </p>
        </div>

        <FooterColumn
          title="Product"
          links={[
            { href: "/pay", label: "Scan and pay" },
            { href: "/merchant", label: "Merchant console" },
            { href: "/status", label: "System status" },
          ]}
        />
        <FooterColumn
          title="Developers"
          links={[
            { href: "/docs", label: "API reference" },
            { href: "/docs#quickstart", label: "Quickstart" },
            { href: "/docs#webhooks", label: "Webhooks" },
          ]}
        />

        <div>
          <p className="eyebrow mb-3">Standards</p>
          <ul className="space-y-2 text-sm text-[var(--color-mist-500)]">
            <li>EMVCo Merchant-Presented QR</li>
            <li>Bank Indonesia QRIS</li>
            <li>CRC-16/CCITT-FALSE</li>
          </ul>
        </div>
      </div>

      <div className="hairline">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-5 text-xs text-[var(--color-mist-600)] sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} CryptoQu. Reference implementation, not a licensed PJP.</p>
          <p className="num">
            Sandbox environment · no custody, no real funds, no live acquirer connection
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: { href: string; label: string }[];
}) {
  return (
    <div>
      <p className="eyebrow mb-3">{title}</p>
      <ul className="space-y-2">
        {links.map((link) => (
          <li key={link.href + link.label}>
            <Link
              href={link.href}
              className="text-sm text-[var(--color-mist-500)] transition-colors hover:text-[var(--color-mist-100)]"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
