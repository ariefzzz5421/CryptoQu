/**
 * The asset and venue universe the payment router plans over.
 *
 * Numbers here are the configuration surface of the routing engine: change a
 * chain's fee or a venue's depth and every quote reprices. In production these
 * rows are loaded from config and refreshed by the liquidity keeper; the values
 * checked in are representative steady-state figures.
 */

export type ChainId =
  | "base"
  | "arbitrum"
  | "polygon"
  | "lisk"
  | "solana"
  | "ethereum";

export type AssetSymbol = "USDC" | "USDT" | "IDRX" | "PYUSD" | "EURC" | "XSGD";

export interface Chain {
  id: ChainId;
  name: string;
  /** EVM chain id, or null for non-EVM networks. */
  evmChainId: number | null;
  family: "evm" | "svm";
  /** Typical stablecoin transfer cost paid by the payer, in USD. */
  transferCostUsd: number;
  /** Seconds until the transfer is safe to settle against. */
  finalitySeconds: number;
  /** Confirmations CryptoQu waits for before releasing IDR to the merchant. */
  confirmations: number;
  explorer: string;
  accent: string;
}

export const CHAINS: Record<ChainId, Chain> = {
  base: {
    id: "base",
    name: "Base",
    evmChainId: 8453,
    family: "evm",
    transferCostUsd: 0.002,
    finalitySeconds: 4,
    confirmations: 2,
    explorer: "https://basescan.org/tx/",
    accent: "#2f6bff",
  },
  arbitrum: {
    id: "arbitrum",
    name: "Arbitrum One",
    evmChainId: 42161,
    family: "evm",
    transferCostUsd: 0.004,
    finalitySeconds: 5,
    confirmations: 2,
    explorer: "https://arbiscan.io/tx/",
    accent: "#3d9bff",
  },
  polygon: {
    id: "polygon",
    name: "Polygon PoS",
    evmChainId: 137,
    family: "evm",
    transferCostUsd: 0.003,
    finalitySeconds: 6,
    confirmations: 6,
    explorer: "https://polygonscan.com/tx/",
    accent: "#8f5bff",
  },
  lisk: {
    id: "lisk",
    name: "Lisk",
    evmChainId: 1135,
    family: "evm",
    transferCostUsd: 0.001,
    finalitySeconds: 4,
    confirmations: 2,
    explorer: "https://blockscout.lisk.com/tx/",
    accent: "#00d1a0",
  },
  solana: {
    id: "solana",
    name: "Solana",
    evmChainId: null,
    family: "svm",
    transferCostUsd: 0.0008,
    finalitySeconds: 2,
    confirmations: 1,
    explorer: "https://solscan.io/tx/",
    accent: "#14f195",
  },
  ethereum: {
    id: "ethereum",
    name: "Ethereum",
    evmChainId: 1,
    family: "evm",
    transferCostUsd: 1.85,
    finalitySeconds: 45,
    confirmations: 3,
    explorer: "https://etherscan.io/tx/",
    accent: "#8b95c9",
  },
};

export interface Asset {
  symbol: AssetSymbol;
  name: string;
  issuer: string;
  /** Currency the token is redeemable in — drives which FX leg the router needs. */
  pegCurrency: "USD" | "IDR" | "EUR" | "SGD";
  decimals: number;
  /** Chains CryptoQu accepts this asset on. */
  chains: ChainId[];
  accent: string;
}

export const ASSETS: Record<AssetSymbol, Asset> = {
  USDC: {
    symbol: "USDC",
    name: "USD Coin",
    issuer: "Circle",
    pegCurrency: "USD",
    decimals: 6,
    chains: ["base", "arbitrum", "polygon", "solana", "ethereum"],
    accent: "#2775ca",
  },
  USDT: {
    symbol: "USDT",
    name: "Tether USD",
    issuer: "Tether",
    pegCurrency: "USD",
    decimals: 6,
    chains: ["base", "arbitrum", "polygon", "lisk", "solana", "ethereum"],
    accent: "#26a17b",
  },
  IDRX: {
    symbol: "IDRX",
    name: "Rupiah Token",
    issuer: "IDRX",
    pegCurrency: "IDR",
    decimals: 2,
    chains: ["polygon", "base", "lisk", "solana"],
    accent: "#e8443f",
  },
  PYUSD: {
    symbol: "PYUSD",
    name: "PayPal USD",
    issuer: "Paxos",
    pegCurrency: "USD",
    decimals: 6,
    chains: ["ethereum", "solana"],
    accent: "#0070ba",
  },
  EURC: {
    symbol: "EURC",
    name: "Euro Coin",
    issuer: "Circle",
    pegCurrency: "EUR",
    decimals: 6,
    chains: ["base", "ethereum", "solana"],
    accent: "#4c6ef5",
  },
  XSGD: {
    symbol: "XSGD",
    name: "StraitsX SGD",
    issuer: "StraitsX",
    pegCurrency: "SGD",
    decimals: 6,
    chains: ["polygon", "ethereum"],
    accent: "#f0a202",
  },
};

/** Every (asset, chain) pair CryptoQu can accept a payment on. */
export interface AcceptedPair {
  asset: AssetSymbol;
  chain: ChainId;
}

export function acceptedPairs(): AcceptedPair[] {
  const pairs: AcceptedPair[] = [];
  for (const asset of Object.values(ASSETS)) {
    for (const chain of asset.chains) pairs.push({ asset: asset.symbol, chain });
  }
  return pairs;
}

export function isAccepted(asset: AssetSymbol, chain: ChainId): boolean {
  return ASSETS[asset]?.chains.includes(chain) ?? false;
}

/**
 * Liquidity venues that can turn an inbound stablecoin into the IDR the
 * acquirer needs. `depthUsd` is the size at which price impact reaches roughly
 * one tick of the impact curve — deeper venues absorb larger tickets flat.
 */
export interface Venue {
  id: string;
  name: string;
  kind: "otc" | "amm" | "issuer" | "internal";
  /** Chains the venue can source from. Empty means chain-agnostic (OTC desk). */
  chains: ChainId[];
  assets: AssetSymbol[];
  feeBps: number;
  depthUsd: number;
  /** Added to the route's expected settlement time. */
  latencySeconds: number;
  /** Largest single fill the venue will quote, in USD. */
  maxTicketUsd: number;
}

export const VENUES: Venue[] = [
  {
    id: "internal-book",
    name: "CryptoQu internal book",
    kind: "internal",
    chains: [],
    assets: ["USDC", "USDT", "IDRX"],
    feeBps: 0,
    depthUsd: 120_000,
    latencySeconds: 0,
    maxTicketUsd: 5_000,
  },
  {
    id: "idrx-mint",
    name: "IDRX issuer redemption",
    kind: "issuer",
    chains: ["polygon", "base", "lisk", "solana"],
    assets: ["IDRX"],
    feeBps: 5,
    depthUsd: 900_000,
    latencySeconds: 3,
    maxTicketUsd: 250_000,
  },
  {
    id: "otc-jakarta",
    name: "Jakarta OTC desk",
    kind: "otc",
    chains: [],
    assets: ["USDC", "USDT", "PYUSD", "EURC", "XSGD"],
    feeBps: 12,
    depthUsd: 2_400_000,
    latencySeconds: 8,
    maxTicketUsd: 500_000,
  },
  {
    id: "amm-onchain",
    name: "On-chain AMM aggregate",
    kind: "amm",
    chains: ["base", "arbitrum", "polygon", "solana", "ethereum", "lisk"],
    assets: ["USDC", "USDT", "IDRX", "EURC", "PYUSD", "XSGD"],
    feeBps: 20,
    depthUsd: 310_000,
    latencySeconds: 2,
    maxTicketUsd: 75_000,
  },
];

/** IDR payout rails that hand the money to the merchant's QRIS acquirer. */
export interface SettlementRail {
  id: string;
  name: string;
  /** Cost per payout in IDR, charged to CryptoQu, not the payer. */
  flatFeeIdr: number;
  latencySeconds: number;
  maxAmountIdr: number;
  operatingHours: "24/7" | "business";
}

export const SETTLEMENT_RAILS: SettlementRail[] = [
  {
    id: "bi-fast",
    name: "BI-FAST",
    flatFeeIdr: 2_500,
    latencySeconds: 12,
    maxAmountIdr: 250_000_000,
    operatingHours: "24/7",
  },
  {
    id: "qris-acquirer",
    name: "QRIS acquirer settlement",
    flatFeeIdr: 0,
    latencySeconds: 25,
    maxAmountIdr: 20_000_000,
    operatingHours: "24/7",
  },
  {
    id: "rtgs",
    name: "BI-RTGS",
    flatFeeIdr: 30_000,
    latencySeconds: 900,
    maxAmountIdr: 50_000_000_000,
    operatingHours: "business",
  },
];

/** CryptoQu's own take rate, applied on top of venue and network costs. */
export const PLATFORM_FEE_BPS = 25;

/** Guardrails enforced on every quote. */
export const LIMITS = {
  minAmountIdr: 1_000,
  /** Single QRIS transaction ceiling under Bank Indonesia rules. */
  maxAmountIdr: 20_000_000,
  /** How long a quote's exchange rate is honoured. */
  quoteTtlSeconds: 90,
  /** Maximum tolerated deviation of a stablecoin from its peg before we refuse. */
  maxPegDeviationBps: 150,
} as const;
