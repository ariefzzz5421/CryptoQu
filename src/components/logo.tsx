/**
 * The mark: a QR finder pattern whose inner eye is a coin. It reads as a QR
 * code at nav size and as a token up close, which is the whole product in one
 * glyph.
 */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <defs>
        <linearGradient id="cq-mark" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ff4d3d" />
          <stop offset="1" stopColor="#00e5b0" />
        </linearGradient>
      </defs>
      {/* Finder pattern frame */}
      <rect
        x="1.5"
        y="1.5"
        width="29"
        height="29"
        rx="8"
        stroke="url(#cq-mark)"
        strokeWidth="3"
      />
      {/* The coin at the centre */}
      <circle cx="16" cy="16" r="6.5" fill="url(#cq-mark)" />
      <path
        d="M18.4 13.2a3.4 3.4 0 1 0 0 5.6"
        stroke="#06080c"
        strokeWidth="1.9"
        strokeLinecap="round"
        fill="none"
      />
      {/* Alignment modules */}
      <rect x="24.5" y="24.5" width="4" height="4" rx="1" fill="#00e5b0" opacity="0.9" />
      <rect x="3.5" y="24.5" width="4" height="4" rx="1" fill="#ff4d3d" opacity="0.55" />
    </svg>
  );
}

export function Wordmark({ size = 28 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2.5">
      <Logo size={size} />
      <span className="text-[15px] font-semibold tracking-tight">
        Crypto<span className="gradient-text">Qu</span>
      </span>
    </span>
  );
}
