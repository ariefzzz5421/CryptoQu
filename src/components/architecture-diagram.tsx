/**
 * The settlement path, drawn as it actually runs: the payer's transfer lands in
 * a vault, the router picks a venue, and rupiah leaves over a payout rail while
 * the merchant's terminal sees an ordinary QRIS payment.
 *
 * Inline SVG so it stays crisp and needs no runtime.
 */
export function ArchitectureDiagram() {
  return (
    <div className="scroll-x">
      <svg
        viewBox="0 0 900 320"
        className="h-auto w-full min-w-[760px]"
        role="img"
        aria-label="CryptoQu settlement architecture: payer wallet to QRIS merchant through vault, router, liquidity venue and payout rail"
      >
        <defs>
          <linearGradient id="arch-flow" x1="0" y1="0" x2="900" y2="0">
            <stop stopColor="#ff4d3d" />
            <stop offset="0.55" stopColor="#ff7a5c" />
            <stop offset="1" stopColor="#00e5b0" />
          </linearGradient>
          <marker id="arch-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
            <path d="M0 0 L9 4.5 L0 9 z" fill="#3d4a60" />
          </marker>
        </defs>

        {/* Spine */}
        <line x1="40" y1="120" x2="860" y2="120" stroke="url(#arch-flow)" strokeWidth="1.5" opacity="0.35" />

        <Node x={40} y={70} w={140} title="Payer wallet" sub="USDC · USDT · IDRX" tone="flame" />
        <Arrow from={180} to={230} y={120} label="transfer" />
        <Node x={230} y={70} w={150} title="Chain watcher" sub="finality + amount match" />
        <Arrow from={380} to={430} y={120} label="funded" />
        <Node x={430} y={70} w={150} title="Payment router" sub="asset · chain · venue" tone="mint" />
        <Arrow from={580} to={630} y={120} label="fill" />
        <Node x={630} y={70} w={140} title="Liquidity venue" sub="OTC · issuer · AMM" />
        <Arrow from={770} to={820} y={120} label="IDR" />
        <Node x={820} y={70} w={40} title="" sub="" hidden />

        {/* Merchant branch */}
        <path
          d="M700 170 L700 235 L300 235"
          stroke="#2c3a4e"
          strokeWidth="1.5"
          fill="none"
          markerEnd="url(#arch-arrow)"
        />
        <text x="505" y="228" textAnchor="middle" fill="#6b7789" fontSize="11" fontFamily="ui-monospace, monospace">
          BI-FAST payout · Rp
        </text>
        <Node x={160} y={210} w={140} title="QRIS merchant" sub="rupiah, same terminal" tone="flame" />

        {/* Ledger rail underneath */}
        <rect x="40" y="278" width="820" height="30" rx="8" fill="#0d1117" stroke="#1e2836" />
        <text x="56" y="297" fill="#8b97ab" fontSize="11" fontFamily="ui-monospace, monospace">
          Double-entry ledger — every leg posted, trial balance zero per currency
        </text>

        {/* Labels above the spine */}
        <text x="40" y="46" fill="#6b7789" fontSize="10.5" fontFamily="ui-monospace, monospace" letterSpacing="1.4">
          ON CHAIN
        </text>
        <text x="630" y="46" fill="#6b7789" fontSize="10.5" fontFamily="ui-monospace, monospace" letterSpacing="1.4">
          OFF CHAIN
        </text>
      </svg>
    </div>
  );
}

function Node({
  x,
  y,
  w,
  title,
  sub,
  tone,
  hidden,
}: {
  x: number;
  y: number;
  w: number;
  title: string;
  sub: string;
  tone?: "flame" | "mint";
  hidden?: boolean;
}) {
  if (hidden) return null;
  const stroke = tone === "flame" ? "#ff4d3d" : tone === "mint" ? "#00e5b0" : "#2c3a4e";
  const opacity = tone ? 0.55 : 1;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={100}
        rx={12}
        fill="#0d1117"
        stroke={stroke}
        strokeOpacity={opacity}
        strokeWidth="1.5"
      />
      <text x={x + w / 2} y={y + 44} textAnchor="middle" fill="#f3f6fb" fontSize="13.5" fontWeight="600">
        {title}
      </text>
      <text
        x={x + w / 2}
        y={y + 66}
        textAnchor="middle"
        fill="#8b97ab"
        fontSize="10.5"
        fontFamily="ui-monospace, monospace"
      >
        {sub}
      </text>
    </g>
  );
}

function Arrow({ from, to, y, label }: { from: number; to: number; y: number; label: string }) {
  return (
    <g>
      <line
        x1={from}
        y1={y}
        x2={to - 4}
        y2={y}
        stroke="#3d4a60"
        strokeWidth="1.5"
        markerEnd="url(#arch-arrow)"
      />
      <text
        x={(from + to) / 2}
        y={y - 10}
        textAnchor="middle"
        fill="#6b7789"
        fontSize="9.5"
        fontFamily="ui-monospace, monospace"
      >
        {label}
      </text>
    </g>
  );
}
