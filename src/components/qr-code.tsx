"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * Renders a QRIS payload as a scannable code.
 *
 * Error correction is fixed at M: QRIS payloads are long enough that H bloats
 * the module count past what a phone camera reads comfortably at counter
 * distance, and M is what acquirers print.
 */
export function QrCode({
  value,
  size = 220,
  className = "",
}: {
  value: string;
  size?: number;
  className?: string;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!value) {
      setDataUrl(null);
      return;
    }

    QRCode.toDataURL(value, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: size * 2,
      color: { dark: "#06080cff", light: "#ffffffff" },
    })
      .then((url) => {
        if (!cancelled) {
          setDataUrl(url);
          setError(null);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (error) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border border-[var(--color-line-strong)] p-4 text-center text-xs text-[var(--color-rose-bad)]"
        style={{ width: size, height: size }}
      >
        Could not render this payload as a QR code: {error}
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden rounded-xl bg-white p-2 ${className}`}
      style={{ width: size, height: size }}
    >
      {dataUrl ? (
        // A data: URI of a locally generated PNG — next/image would add no value here.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={dataUrl}
          alt="QRIS payment code"
          width={size}
          height={size}
          className="h-full w-full"
        />
      ) : (
        <div className="h-full w-full animate-pulse rounded-lg bg-[var(--color-mist-300)]" />
      )}
    </div>
  );
}
