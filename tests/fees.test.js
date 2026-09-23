"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const FE = require("../site/fees.js");

const R = FE.DEFAULTS;
const bursa = (v, opt = {}) => FE.bursaFees(v, { type: "ordinary", ...opt }, R.bursa);
const us = (v, n, side, opt = {}) => FE.usFees(v, n, side, { usType: "nms", fx: 4.2, ...opt }, R.us);

test("engine and defaults are immutable", () => {
  assert.ok(Object.isFrozen(FE));
  assert.ok(Object.isFrozen(FE.DEFAULTS.bursa));
  assert.ok(Object.isFrozen(FE.DEFAULTS.us));
});

test("rounding helpers are cent-safe", () => {
  assert.equal(FE.ceil2(0.3), 0.3);                 // v16 bug: exact cents were bumped to 0.31
  assert.equal(FE.ceil2(1000 * 0.0003), 0.3);       // FP noise must not round up
  assert.equal(FE.ceil2(0.361), 0.37);
  assert.equal(FE.round2(0.365), 0.37);
  assert.equal(FE.round2(1.005), 1.01);
});

test("bursa: matches real Moomoo buy — MAYBANK 1,000 @ 10.62 (27 Aug 2026)", () => {
  assert.deepEqual(bursa(10620), {
    lines: { commission: 3.19, platform: 3, clearing: 3.19, stamp: 11, sst: 0 }, total: 20.38
  });
});

test("bursa: matches real Moomoo sell — MAYBANK 300 @ 9.80 (24 Jun 2025)", () => {
  // 0.03% of 2,940 = 0.882: brokerage rounds to nearest (0.88), clearing rounds up (0.89)
  assert.deepEqual(bursa(2940), {
    lines: { commission: 0.88, platform: 3, clearing: 0.89, stamp: 3, sst: 0 }, total: 7.77
  });
});

test("bursa: RM1,200 ordinary share buy", () => {
  assert.deepEqual(bursa(1200), {
    lines: { commission: 0.36, platform: 3, clearing: 0.36, stamp: 2, sst: 0 }, total: 5.72
  });
});

test("bursa: exact RM1,000 has RM1 stamp duty, not RM2", () => {
  assert.equal(bursa(1000).lines.stamp, 1);
  assert.equal(bursa(1000.01).lines.stamp, 2);
});

test("bursa: caps on clearing and stamp duty", () => {
  const f = bursa(5e6);
  assert.equal(f.lines.clearing, 1000);
  assert.equal(f.lines.stamp, 1000);
  assert.equal(f.lines.commission, 1500);           // commission has no cap
});

test("bursa: ETF is stamp-exempt and pays 8% SST on commission + platform + clearing", () => {
  const f = bursa(10000, { type: "etf" });
  assert.equal(f.lines.stamp, 0);
  assert.equal(f.lines.sst, 0.72);                  // 8% of (3 + 3 + 3)
  assert.equal(f.total, 9.72);
});

test("bursa: REIT and warrant pay SST and stamp duty; ordinary pays no SST", () => {
  for (const type of ["reit", "warrant", "other"]) {
    const f = bursa(10000, { type });
    assert.equal(f.lines.stamp, 10, type);
    assert.equal(f.lines.sst, 0.72, type);
  }
  assert.equal(bursa(10000).lines.sst, 0);
});

test("bursa: 0% commission promo only removes commission", () => {
  const f = bursa(1200, { promo: true });
  assert.equal(f.lines.commission, 0);
  assert.equal(f.total, 5.36);
});

test("bursa: zero or invalid value costs nothing", () => {
  for (const v of [0, -5, NaN]) assert.equal(bursa(v).total, 0);
});

test("us: matches real Moomoo buy — VOO 1 @ 585.04 (30 Mar 2026, USD/MYR ~4.0)", () => {
  assert.deepEqual(us(585.04, 1, "buy", { fx: 4.0 }), {
    lines: { commission: 0.18, platform: 0.99, settlement: 0, sec: 0, taf: 0, cat: 0, stamp: 0.75, sst: 0 },
    total: 1.92, frac: false
  });
});

test("us: matches real Moomoo fractional sell — VOO 0.3 @ 709.12 (4 Aug 2026, USD/MYR ~4.0)", () => {
  // No commission, platform capped at 0.99, no settlement/SEC/TAF, stamp RM1 -> $0.25
  assert.deepEqual(us(212.74, 0.3, "sell", { fx: 4.0 }), {
    lines: { commission: 0, platform: 0.99, settlement: 0, sec: 0, taf: 0, cat: 0, stamp: 0.25, sst: 0 },
    total: 1.24, frac: true
  });
});

test("us: matches real Moomoo fractional buy — MU 0.3 @ 767.59 (29 Jul 2026, USD/MYR ~4.2)", () => {
  assert.deepEqual(us(230.28, 0.3, "buy", { fx: 4.2 }), {
    lines: { commission: 0, platform: 0.99, settlement: 0, sec: 0, taf: 0, cat: 0, stamp: 0.24, sst: 0 },
    total: 1.23, frac: true
  });
});

test("us: matches real Moomoo sell — MU 1 @ 965.38 (13 Aug 2026, USD/MYR ~4.09)", () => {
  // First real sell with SEC, TAF and CAT lines: SEC 0.0199 -> 0.02, TAF minimum 0.01, CAT rounds to 0
  assert.deepEqual(us(965.38, 1, "sell", { fx: 4.09 }), {
    lines: { commission: 0.29, platform: 0.99, settlement: 0, sec: 0.02, taf: 0.01, cat: 0, stamp: 0.98, sst: 0 },
    total: 2.29, frac: false
  });
});

test("us: USD1,000 buy (10 shares) at 4.20", () => {
  assert.deepEqual(us(1000, 10, "buy"), {
    lines: { commission: 0.3, platform: 0.99, settlement: 0.03, sec: 0, taf: 0, cat: 0, stamp: 1.19, sst: 0 },
    total: 2.51, frac: false
  });
});

test("us: SEC and TAF apply on sells only, with minimums", () => {
  const f = us(1000, 10, "sell");
  assert.equal(f.lines.sec, 0.03);                  // 1000 * 20.6 / 1e6 = 0.0206 -> up to 0.03
  assert.equal(f.lines.taf, 0.01);                  // 10 * 0.000195 -> min 0.01
  assert.equal(us(1, 1, "sell").lines.sec, 0.01);   // minimum
});

test("us: TAF capped at USD9.79", () => {
  assert.equal(us(1e6, 100000, "sell").lines.taf, 9.79);
});

test("us: settlement capped at 1% of value", () => {
  assert.equal(us(10, 100, "buy").lines.settlement, 0.1);    // 100 * 0.003 = 0.30 > 1% of 10
});

test("us: fractional order (< 1 share)", () => {
  const f = us(5, 0.05, "sell");
  assert.equal(f.frac, true);
  assert.equal(f.lines.commission, 0);
  assert.equal(f.lines.platform, 0.05);             // 0.99% of 5
  assert.equal(f.lines.settlement, 0);
  assert.equal(f.lines.sec, 0);
  assert.equal(f.lines.taf, 0);
  assert.equal(us(500, 0.5, "buy").lines.platform, 0.99);    // capped
});

test("us: stamp duty computed in MYR, capped at RM1,000", () => {
  assert.equal(us(1000, 10, "buy", { fx: 4.2 }).lines.stamp, 1.19);    // RM4,200 -> RM5 -> $1.19
  assert.equal(us(1e7, 1000, "buy", { fx: 4.2 }).lines.stamp, 238.1);  // RM1,000 cap / 4.2
  assert.equal(us(1000, 10, "buy", { fx: 0 }).lines.stamp, 0);         // no FX -> not computed
});

test("us: optional SST on commission + platform", () => {
  assert.equal(us(1000, 10, "buy", { usSst: true }).lines.sst, 0.1);   // 8% of 1.29
});

test("us: OTC CAT rate differs from NMS", () => {
  const nms = us(1e6, 1e6, "buy").lines.cat;
  const otc = us(1e6, 1e6, "buy", { usType: "otc" }).lines.cat;
  assert.equal(nms, 3);
  assert.equal(otc, 0.03);
});

test("tick sizes and round-up", () => {
  assert.equal(FE.roundUpTick("bursa", 0.9951), 1);
  assert.equal(FE.roundUpTick("bursa", 1.0234), 1.03);
  assert.equal(FE.roundUpTick("bursa", 12.345), 12.36);
  assert.equal(FE.roundUpTick("bursa", 99.99), 100);
  assert.equal(FE.roundUpTick("us", 150.633), 150.64);
  assert.equal(FE.roundUpTick("us", 0.12341), 0.1235);
});

test("break-even covers buy cash-out after sell fees", () => {
  for (const [market, price, shares] of [["bursa", 1.2, 1000], ["us", 150, 10], ["us", 5, 0.5]]) {
    const opt = { type: "ordinary", usType: "nms", fx: 4.2 };
    const value = FE.round2(price * shares);
    const cashOut = value + FE.fees(market, value, shares, "buy", opt, R).total;
    const be = FE.breakEven(market, cashOut, shares, opt, R);
    const net = p => p * shares - FE.fees(market, p * shares, shares, "sell", opt, R).total;
    assert.ok(be > price, `${market}: break-even above buy`);
    assert.ok(net(be) >= cashOut - 1e-9, `${market}: covers cost`);
    assert.ok(net(be - 0.001) < cashOut, `${market}: is the lowest such price`);
  }
  assert.equal(FE.breakEven("bursa", 0, 100, {}, R), 0);
});

test("target sell price: lowest price reaching the net profit target", () => {
  const cases = [
    ["bursa", 10.62, 1000, 10],   // Maybank-sized Bursa trade, +10%
    ["bursa", 0.5, 2000, 25],     // penny stock, sub-RM1 ticks
    ["us", 585.04, 1, 5],         // 1-share US trade
    ["us", 600, 0.3, 20]          // fractional US trade
  ];
  for (const [market, price, shares, pct] of cases) {
    const opt = { type: "ordinary", usType: "nms", fx: 4.0 };
    const value = FE.round2(price * shares);
    const cashOut = value + FE.fees(market, value, shares, "buy", opt, R).total;
    const goal = cashOut * (1 + pct / 100);
    const net = p => p * shares - FE.fees(market, p * shares, shares, "sell", opt, R).total;
    const tp = FE.targetSellPrice(market, cashOut, shares, opt, R, pct);
    const label = `${market} ${price}x${shares} +${pct}%`;
    assert.ok(net(tp) >= goal - 1e-9, `${label}: reaches target`);
    assert.ok(net(tp - 0.001) < goal, `${label}: is the lowest such price`);
    const tick = FE.roundUpTick(market, tp);
    assert.ok(tick >= tp && net(tick) >= goal - 1e-9, `${label}: tradable price still meets target`);
  }
});

test("target sell price: 0% equals break-even; invalid input returns 0", () => {
  const opt = { type: "ordinary" };
  const cashOut = 10620 + FE.bursaFees(10620, opt, R.bursa).total;
  assert.equal(FE.targetSellPrice("bursa", cashOut, 1000, opt, R, 0), FE.breakEven("bursa", cashOut, 1000, opt, R));
  assert.equal(FE.targetSellPrice("bursa", 0, 1000, opt, R, 10), 0);
  assert.equal(FE.targetSellPrice("bursa", cashOut, 0, opt, R, 10), 0);
  assert.equal(FE.targetSellPrice("bursa", cashOut, 1000, opt, R, -100), 0);
});
