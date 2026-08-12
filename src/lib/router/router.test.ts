import { describe, expect, it } from "vitest";

import { planRoutes, RouteError, roundUpTo, toMinorUnits, type PlanContext } from "./engine";
import { median } from "./fx";
import { ASSETS, LIMITS, PLATFORM_FEE_BPS } from "./registry";
import type { RateSnapshot } from "./fx";

function snapshot(rate: number, overrides: Partial<RateSnapshot> = {}): RateSnapshot {
  return {
    base: "USD",
    quote: "IDR",
    rate,
    samples: [{ source: "test", rate, fetchedAt: 0, live: true }],
    dispersionBps: 0,
    asOf: 0,
    degraded: false,
    ...overrides,
  };
}

const CONTEXT: PlanContext = {
  rates: {
    USD: snapshot(16_000),
    IDR: snapshot(1),
    EUR: snapshot(17_400),
    SGD: snapshot(12_000),
  },
};

describe("amount guards", () => {
  it("rejects dust below the minimum", () => {
    expect(() => planRoutes({ amountIdr: 500 }, CONTEXT)).toThrow(RouteError);
  });

  it("rejects anything above the QRIS transaction ceiling", () => {
    expect(() => planRoutes({ amountIdr: LIMITS.maxAmountIdr + 1 }, CONTEXT)).toThrow(
      /ceiling/i,
    );
  });

  it("accepts an amount exactly at each boundary", () => {
    expect(planRoutes({ amountIdr: LIMITS.minAmountIdr }, CONTEXT).routes.length).toBeGreaterThan(0);
    expect(planRoutes({ amountIdr: LIMITS.maxAmountIdr }, CONTEXT).routes.length).toBeGreaterThan(0);
  });
});

describe("route planning", () => {
  it("prices a route for every accepted asset and chain pair", () => {
    const plan = planRoutes({ amountIdr: 50_000 }, CONTEXT);
    const expectedPairs = Object.values(ASSETS).reduce((n, asset) => n + asset.chains.length, 0);
    expect(plan.routes.length + plan.rejected.length).toBe(expectedPairs);
    expect(plan.best).not.toBeNull();
  });

  it("collects the merchant's exact rupiah amount on every route", () => {
    const plan = planRoutes({ amountIdr: 137_500 }, CONTEXT);
    for (const route of plan.routes) {
      expect(route.amountOutIdr).toBe(137_500);
    }
  });

  it("never collects less than the merchant is owed", () => {
    // Rounding up to the asset's precision must always favour the merchant.
    for (const amount of [1_000, 7_777, 33_333, 999_999]) {
      const plan = planRoutes({ amountIdr: amount }, CONTEXT);
      for (const route of plan.routes) {
        const collectedIdr = route.amountIn * route.referenceRate;
        expect(collectedIdr).toBeGreaterThanOrEqual(amount);
      }
    }
  });

  it("charges at least the platform take rate on every route", () => {
    const plan = planRoutes({ amountIdr: 50_000 }, CONTEXT);
    for (const route of plan.routes) {
      expect(route.costs.totalBps).toBeGreaterThanOrEqual(PLATFORM_FEE_BPS);
      expect(route.costs.totalBps).toBe(
        route.costs.platformFeeBps +
          route.costs.venueFeeBps +
          route.costs.priceImpactBps +
          route.costs.fxSpreadBps,
      );
    }
  });

  it("skips the FX spread for a rupiah-pegged asset", () => {
    const plan = planRoutes({ amountIdr: 50_000, assets: ["IDRX"] }, CONTEXT);
    expect(plan.routes.length).toBeGreaterThan(0);
    for (const route of plan.routes) {
      expect(route.costs.fxSpreadBps).toBe(0);
      // One rupiah token is worth one rupiah, so the reference rate is ~1.
      expect(route.referenceRate).toBeCloseTo(1, 6);
    }
  });

  it("sorts routes by score with the best one first", () => {
    const plan = planRoutes({ amountIdr: 250_000 }, CONTEXT);
    const scores = plan.routes.map((route) => route.score);
    expect([...scores].sort((a, b) => a - b)).toEqual(scores);
    expect(plan.best?.id).toBe(plan.routes[0].id);
  });

  it("prefers a cheap chain over Ethereum when optimising for cost", () => {
    const plan = planRoutes({ amountIdr: 50_000, objective: "cost" }, CONTEXT);
    expect(plan.best?.chain).not.toBe("ethereum");
  });

  it("picks a low-latency route when optimising for speed", () => {
    const cheap = planRoutes({ amountIdr: 50_000, objective: "cost" }, CONTEXT).best!;
    const fast = planRoutes({ amountIdr: 50_000, objective: "speed" }, CONTEXT).best!;
    expect(fast.etaSeconds).toBeLessThanOrEqual(cheap.etaSeconds);
  });

  it("honours asset and chain filters", () => {
    const plan = planRoutes({ amountIdr: 50_000, assets: ["USDC"], chains: ["base"] }, CONTEXT);
    expect(plan.routes).toHaveLength(1);
    expect(plan.routes[0].asset).toBe("USDC");
    expect(plan.routes[0].chain).toBe("base");
  });

  it("drops routes that miss an ETA constraint and records why", () => {
    const plan = planRoutes({ amountIdr: 50_000, maxEtaSeconds: 1 }, CONTEXT);
    expect(plan.routes).toHaveLength(0);
    expect(plan.best).toBeNull();
    expect(plan.rejected.every((entry) => entry.reason === "slower than requested")).toBe(true);
  });

  it("charges more in price impact as the ticket grows against venue depth", () => {
    const small = planRoutes({ amountIdr: 20_000, assets: ["USDC"], chains: ["base"] }, CONTEXT)
      .routes[0];
    const large = planRoutes({ amountIdr: 19_000_000, assets: ["USDC"], chains: ["base"] }, CONTEXT)
      .routes[0];
    expect(large.costs.priceImpactBps).toBeGreaterThan(small.costs.priceImpactBps);
  });

  it("routes a large ticket to a deeper venue than a small one", () => {
    const small = planRoutes({ amountIdr: 10_000, assets: ["USDC"], chains: ["base"] }, CONTEXT)
      .routes[0];
    const large = planRoutes({ amountIdr: 19_000_000, assets: ["USDC"], chains: ["base"] }, CONTEXT)
      .routes[0];
    expect(large.venue.depthUsd).toBeGreaterThan(small.venue.depthUsd);
  });

  it("selects a 24/7 payout rail for a normal ticket", () => {
    const plan = planRoutes({ amountIdr: 500_000 }, CONTEXT);
    expect(plan.best?.rail.operatingHours).toBe("24/7");
  });

  it("marks the plan degraded when the rate feed is running on the baseline", () => {
    const degraded: PlanContext = {
      rates: { ...CONTEXT.rates, USD: snapshot(16_250, { degraded: true }) },
    };
    const plan = planRoutes({ amountIdr: 50_000, assets: ["USDC"] }, degraded);
    expect(plan.degradedRates).toBe(true);
    expect(plan.best?.warnings.join(" ")).toMatch(/baseline/i);
  });

  it("describes each route as transfer, convert, then settle", () => {
    const route = planRoutes({ amountIdr: 50_000 }, CONTEXT).best!;
    expect(route.legs.map((leg) => leg.kind)).toEqual(["transfer", "convert", "settle"]);
    expect(route.etaSeconds).toBe(route.legs.reduce((total, leg) => total + leg.etaSeconds, 0));
    // The rail fee is CryptoQu's cost, never the payer's.
    expect(route.legs.find((leg) => leg.kind === "settle")?.bornBy).toBe("platform");
  });

  it("quotes a worse effective rate than mid-market, by exactly the cost stack", () => {
    const route = planRoutes({ amountIdr: 100_000, assets: ["USDC"], chains: ["base"] }, CONTEXT)
      .routes[0];
    expect(route.effectiveRate).toBeLessThan(route.referenceRate);
    const impliedBps = (1 - route.effectiveRate / route.referenceRate) * 10_000;
    // Rounding up to 6dp adds a sliver on top of the quoted cost.
    expect(impliedBps).toBeGreaterThanOrEqual(route.costs.totalBps - 1);
    expect(impliedBps).toBeLessThan(route.costs.totalBps + 5);
  });
});

describe("precision helpers", () => {
  it("rounds up to the asset's decimals", () => {
    expect(roundUpTo(1.0000001, 6)).toBe(1.000001);
    expect(roundUpTo(1.5, 0)).toBe(2);
    expect(roundUpTo(12.341, 2)).toBe(12.35);
  });

  it("does not inflate a value already at precision", () => {
    expect(roundUpTo(12.34, 2)).toBe(12.34);
    expect(roundUpTo(3, 6)).toBe(3);
  });

  it("renders minor units without a decimal point or leading zeros", () => {
    expect(toMinorUnits(1.5, 6)).toBe("1500000");
    expect(toMinorUnits(0.25, 2)).toBe("25");
    expect(toMinorUnits(12345.67, 2)).toBe("1234567");
  });
});

describe("median", () => {
  it("handles odd and even sample counts", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});
