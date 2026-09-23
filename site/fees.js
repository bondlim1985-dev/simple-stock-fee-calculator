/*
 * Moomoo Malaysia fee engine — pure functions, no DOM, no network.
 * Loaded as a classic script in the browser (exposes window.FeeEngine)
 * and as a CommonJS module in Node for unit tests.
 */
"use strict";
(function (root) {

/* ---------- Fee schedule defaults ---------- */
const RATES_AS_OF = "2026-09";

const DEFAULTS = Object.freeze({
  bursa: Object.freeze({
    commPct: 0.03,      // % of value, rounded to nearest RM0.01, no minimum
    platform: 3,        // RM per order
    clearPct: 0.03,     // % of value, rounded UP to RM0.01
    clearCap: 1000,     // RM
    stampPer1k: 1,      // RM per RM1,000 or part thereof
    stampCap: 1000,     // RM
    sstPct: 8           // on commission + platform + clearing (non-ordinary products)
  }),
  us: Object.freeze({
    commPct: 0.03,      // % of value
    platform: 0.99,     // USD per order (>= 1 share)
    fracPlatPct: 0.99,  // % of value for orders < 1 share
    fracPlatCap: 0.99,  // USD cap for orders < 1 share
    settle: 0.003,      // USD per share
    settleCapPct: 1,    // % of value
    secPerM: 20.6,      // USD per USD1m sold
    secMin: 0.01,
    taf: 0.000195,      // USD per share sold
    tafMin: 0.01,
    tafMax: 9.79,
    catNms: 0.000003,   // USD per share
    catOtc: 0.00000003, // USD per share
    stampPer1k: 1,      // RM per RM1,000 or part (Malaysian contract-note stamp duty)
    stampCap: 1000,     // RM
    sstPct: 8
  })
});

/* When each rate took effect, and whether it is confirmed. Update here when a rate changes. */
const RATE_NOTES = Object.freeze({
  bursa: Object.freeze({
    commPct: "Rounding verified against Moomoo trades (Aug 2026, Jun 2025)",
    stampPer1k: "RM1 per RM1,000, cap RM1,000 — from 1 Jan 2024",
    sstPct: "8% SST on non-ordinary products — from 1 Oct 2025"
  }),
  us: Object.freeze({
    secPerM: "SEC Section 31 rate — from 4 Apr 2026; verified on a real sell (Aug 2026)",
    taf: "FINRA TAF — from 1 Jan 2026; USD0.01 minimum verified (Aug 2026)",
    catNms: "Charged per share (line confirmed Aug 2026); rate unconfirmed — rounds to 0 below ~1,700 shares",
    fracPlatPct: "USD0.99 cap verified (Aug 2026); the 0.99% rate itself is unconfirmed",
    sstPct: "Not charged on US trades (verified Mar/Aug 2026) — leave unticked",
    commPct: "0.03% and USD0.99 platform fee verified on a real 1-share buy (Mar 2026)"
  })
});

const SST_BURSA = Object.freeze(["etf", "reit", "warrant", "other"]);

/* ---------- Numeric helpers (cent-safe rounding) ---------- */
const EPS = 1e-9;
const round2 = n => Math.round((n + EPS) * 100) / 100;   // half-up to cent
const ceil2 = n => Math.ceil(n * 100 - 1e-7) / 100;      // up to cent, tolerant of FP noise
const sum = o => Object.values(o).reduce((a, b) => a + b, 0);

/* ---------- Fee engines ---------- */
/**
 * @param {number} value  trade value in RM
 * @param {{promo?:boolean,type?:string}} opt
 * @param {object} r      bursa rate table
 */
function bursaFees(value, opt, r) {
  if (!(value > 0)) return { lines: {}, total: 0 };
  // Rounding verified against real Moomoo MY trades: brokerage to nearest sen, clearing up to next sen.
  const commission = opt.promo ? 0 : round2(value * r.commPct / 100);
  const platform = r.platform;
  const clearing = Math.min(ceil2(value * r.clearPct / 100), r.clearCap);
  const stamp = opt.type === "etf" ? 0 : Math.min(Math.ceil(value / 1000 - EPS) * r.stampPer1k, r.stampCap);
  const sst = SST_BURSA.includes(opt.type) ? round2((commission + platform + clearing) * r.sstPct / 100) : 0;
  const lines = { commission, platform, clearing, stamp, sst };
  return { lines, total: round2(sum(lines)) };
}

/**
 * @param {number} value   trade value in USD
 * @param {number} shares
 * @param {"buy"|"sell"} side
 * @param {{promo?:boolean,usType?:string,usSst?:boolean,fx?:number}} opt
 * @param {object} r       us rate table
 */
function usFees(value, shares, side, opt, r) {
  if (!(value > 0) || !(shares > 0)) return { lines: {}, total: 0, frac: false };
  const frac = shares < 1;
  const sell = side === "sell";
  // Orders < 1 share: no commission (verified on a real 0.3-share sell, Aug 2026).
  const commission = opt.promo || frac ? 0 : round2(value * r.commPct / 100);
  const platform = frac ? round2(Math.min(value * r.fracPlatPct / 100, r.fracPlatCap)) : r.platform;
  // Orders < 1 share: no settlement, SEC or TAF.
  const settlement = frac ? 0 : round2(Math.min(shares * r.settle, value * r.settleCapPct / 100));
  const sec = sell && !frac ? Math.max(ceil2(value * r.secPerM / 1e6), r.secMin) : 0;
  const taf = sell && !frac ? Math.min(Math.max(ceil2(shares * r.taf), r.tafMin), r.tafMax) : 0;
  const cat = round2(shares * (opt.usType === "otc" ? r.catOtc : r.catNms));
  let stamp = 0;
  if (opt.fx > 0) {
    const stampMyr = Math.min(Math.ceil(value * opt.fx / 1000 - EPS) * r.stampPer1k, r.stampCap);
    stamp = round2(stampMyr / opt.fx);
  }
  const sst = opt.usSst ? round2((commission + platform) * r.sstPct / 100) : 0;
  const lines = { commission, platform, settlement, sec, taf, cat, stamp, sst };
  return { lines, total: round2(sum(lines)), frac };
}

function fees(market, value, shares, side, opt, rates) {
  return market === "us" ? usFees(value, shares, side, opt, rates.us) : bursaFees(value, opt, rates.bursa);
}

/* ---------- Tick size (round break-even up to a tradable price) ---------- */
function tickFor(market, price) {
  if (market === "us") return price < 1 ? 0.0001 : 0.01;
  if (price < 1) return 0.005;
  if (price < 10) return 0.01;
  if (price < 100) return 0.02;
  return 0.1;
}
function roundUpTick(market, p) {
  let t = tickFor(market, p);
  let q = Math.ceil(p / t - 1e-7) * t;
  // Crossing a tick band boundary can change the tick; re-snap once.
  t = tickFor(market, q);
  q = Math.ceil(p / t - 1e-7) * t;
  return Number(q.toFixed(4));
}

/**
 * Lowest sell price whose net proceeds (after sell fees) reach cashOut * (1 + targetPct / 100).
 * Profit % is measured on total cash out (buy value + buy fees), same as the P/L return. 0 if unreachable.
 */
function targetSellPrice(market, cashOut, shares, opt, rates, targetPct) {
  if (!(cashOut > 0) || !(shares > 0) || !(targetPct > -100)) return 0;
  const goal = cashOut * (1 + targetPct / 100);
  const net = p => { const v = p * shares; return v - fees(market, v, shares, "sell", opt, rates).total; };
  let lo = 0, hi = Math.max(0.01, goal / shares * 1.5), guard = 0;
  while (net(hi) < goal && guard++ < 60) hi *= 2;
  if (net(hi) < goal) return 0;
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (net(mid) >= goal) hi = mid; else lo = mid; }
  return hi;
}

/** Lowest sell price whose net proceeds cover cashOut. 0 if unreachable. */
function breakEven(market, cashOut, shares, opt, rates) {
  return targetSellPrice(market, cashOut, shares, opt, rates, 0);
}

const api = Object.freeze({
  RATES_AS_OF, DEFAULTS, RATE_NOTES, SST_BURSA,
  round2, ceil2, bursaFees, usFees, fees, tickFor, roundUpTick, breakEven, targetSellPrice
});

if (typeof module === "object" && module.exports) module.exports = api;
else root.FeeEngine = api;

})(typeof globalThis !== "undefined" ? globalThis : this);
