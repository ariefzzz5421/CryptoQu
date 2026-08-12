"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { Wordmark } from "./logo";

const LINKS = [
  { href: "/pay", label: "Pay" },
  { href: "/merchant", label: "Merchant" },
  { href: "/docs", label: "API" },
  { href: "/status", label: "Status" },
];

export function SiteNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--color-line)] bg-[rgba(6,8,12,0.82)] backdrop-blur-xl">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
        <Link href="/" className="shrink-0" aria-label="CryptoQu home">
          <Wordmark />
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {LINKS.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-[var(--color-ink-700)] text-[var(--color-mist-100)]"
                    : "text-[var(--color-mist-500)] hover:text-[var(--color-mist-100)]"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>

        <div className="hidden md:block">
          <Link href="/pay" className="btn btn-primary">
            Try a payment
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="btn btn-ghost px-3 py-1.5 md:hidden"
          aria-expanded={open}
          aria-label="Toggle navigation"
        >
          {open ? "Close" : "Menu"}
        </button>
      </nav>

      {open && (
        <div className="border-t border-[var(--color-line)] px-5 py-3 md:hidden">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2.5 text-sm text-[var(--color-mist-300)]"
            >
              {link.label}
            </Link>
          ))}
        </div>
      )}
    </header>
  );
}
