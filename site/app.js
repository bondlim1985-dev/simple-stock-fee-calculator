"use strict";
(() => {
const $ = id => document.getElementById(id);
const FE = window.FeeEngine;
const { DEFAULTS, round2 } = FE;

const RATE_FIELDS = {
  bursa: [
    ["commPct","Commission %"],["platform","Platform fee (RM)"],
    ["clearPct","Clearing %"],["clearCap","Clearing cap (RM)"],
    ["stampPer1k","Stamp duty per RM1k"],["stampCap","Stamp duty cap (RM)"],
    ["sstPct","SST %"]
  ],
  us: [
    ["commPct","Commission %"],["platform","Platform fee ($)"],
    ["fracPlatPct","Fractional platform %"],["fracPlatCap","Fractional platform cap ($)"],
    ["settle","Settlement $/share"],["settleCapPct","Settlement cap %"],
    ["secPerM","SEC $ per $1m sold"],["secMin","SEC min ($)"],
    ["taf","TAF $/share sold"],["tafMax","TAF max ($)"],
    ["catNms","CAT NMS $/share"],["catOtc","CAT OTC $/share"],
    ["stampPer1k","Stamp duty per RM1k"],["stampCap","Stamp duty cap (RM)"],
    ["sstPct","SST %"]
  ]
};

/* ---------- State ---------- */
const STORE_KEY = "moomooFeeCalc.v17";
const state = { market: "bursa", calc: "trade", rates: clone(DEFAULTS) };

function clone(o){ return JSON.parse(JSON.stringify(o)); }
function load(){
  let s = null;
  try{ s = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); }
  catch{ return; }   // storage unavailable or corrupt: keep defaults
  if(!s || typeof s !== "object") return;
  if(["bursa","us"].includes(s.market)) state.market = s.market;
  if(["trade","avg","budget"].includes(s.calc)) state.calc = s.calc;
  loadRates(s.rates);
  loadInputs(s);
  loadFx(s);
}
function loadRates(saved){
  for(const m of ["bursa","us"]){
    for(const k of Object.keys(DEFAULTS[m])){
      const v = saved?.[m]?.[k];
      if(typeof v === "number" && Number.isFinite(v) && v >= 0) state.rates[m][k] = v;
    }
  }
}
function loadInputs(s){
  if(typeof s.fx === "string") $("fx").value = s.fx;
  if(typeof s.targetPct === "string" && /^\d{0,4}(?:\.\d{0,2})?$/.test(s.targetPct)) $("targetPct").value = s.targetPct;
  if(typeof s.bursaType === "string" && $("bursaType").querySelector(`option[value="${CSS.escape(s.bursaType)}"]`)) $("bursaType").value = s.bursaType;
  if(["nms","otc"].includes(s.usType)) $("usType").value = s.usType;
  $("promo").checked = !!s.promo;
  $("usSst").checked = !!s.usSst;
}
function loadFx(s){
  if(["manual","live"].includes(s.fxMode)) fx.mode = s.fxMode;
  const l = s.fxLive;
  if(l && validFx(l.rate) && typeof l.date === "string" && typeof l.at === "number") fx.live = l;
}
function save(){
  try{
    localStorage.setItem(STORE_KEY, JSON.stringify({
      market: state.market, calc: state.calc, rates: state.rates,
      fx: $("fx").value, targetPct: $("targetPct").value, bursaType: $("bursaType").value, usType: $("usType").value,
      promo: $("promo").checked, usSst: $("usSst").checked,
      fxMode: fx.mode, fxLive: fx.live
    }));
  }catch{
    // Storage full, disabled or in private mode: settings just won't persist; the calculator still works.
  }
}

/* ---------- Live FX (ECB reference rate via Frankfurter) ---------- */
const FX_URL = "https://api.frankfurter.dev/v1/latest?base=USD&symbols=MYR";
const FX_TTL_MS = 60 * 60 * 1000;      // re-fetch at most hourly
const fx = { mode: "live", live: null, busy: false };

function validFx(v){ return typeof v === "number" && Number.isFinite(v) && v > 1 && v < 10; }
function fxStatus(text, cls){ const n = $("fxStatus"); n.textContent = text; n.className = "hint" + (cls ? " " + cls : ""); }
function fxDateLabel(d){
  const t = Date.parse(d + "T00:00:00Z");
  return Number.isFinite(t) ? new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : d;
}
function showFxState(){
  if(fx.busy) fxStatus("Fetching live rate…");
  else if(fx.mode === "manual") fxStatus("Manual rate — tap Live to use the market rate");
  else if(fx.live) fxStatus(`ECB reference rate · ${fxDateLabel(fx.live.date)}`, "ok");
  else fxStatus("Default rate — tap Live to fetch");
}
async function fetchFx(force){
  if(fx.busy) return;
  if(!force && fx.live && Date.now() - fx.live.at < FX_TTL_MS){
    if(fx.mode === "live"){ $("fx").value = fx.live.rate.toFixed(4); update(false); }
    showFxState();
    return;
  }
  fx.busy = true; $("fxRefresh").disabled = true; showFxState();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try{
    const res = await fetch(FX_URL, { signal: ctrl.signal, credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
    if(!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const rate = data && data.rates && data.rates.MYR;
    const date = data && typeof data.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.date) ? data.date : "";
    if(!validFx(rate) || !date) throw new Error("Unexpected response");
    fx.live = { rate, date, at: Date.now() };
    fx.mode = "live";
    $("fx").value = rate.toFixed(4);
    $("fx").classList.remove("bad");
    fx.busy = false; showFxState();
  }catch{
    // Network error, timeout or unexpected payload: fall back to the last live rate or the rate already shown.
    fx.busy = false;
    if(fx.live) $("fx").value = fx.live.rate.toFixed(4);
    fxStatus(fx.live ? `Offline — using last live rate (${fxDateLabel(fx.live.date)})` : "Couldn't fetch live rate — using the rate shown", "err");
  }finally{
    clearTimeout(timer);
    $("fxRefresh").disabled = false;
    update(false);
  }
}

/** Parse a field. Returns {v, ok}. Empty = 0 (ok). Negative / junk = invalid. */
function readNum(id){
  const el = $(id);
  const raw = el.value.replace(/[,\s]/g, "");
  if(raw === ""){ el.classList.remove("bad"); return { v: 0, ok: true, empty: true }; }
  const ok = /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw);   // 12, 12., 12.5, .5 — linear-time, no backtracking
  const v = ok ? Number(raw) : NaN;
  const good = ok && Number.isFinite(v);
  el.classList.toggle("bad", !good);
  return { v: good ? v : 0, ok: good, empty: false };
}

/* ---------- Engine bindings (logic lives in fees.js) ---------- */
const fees = (value, shares, side, opt) => FE.fees(state.market, value, shares, side, opt, state.rates);
const roundUpTick = p => FE.roundUpTick(state.market, p);
const breakEven = (cashOut, shares, opt) => FE.breakEven(state.market, cashOut, shares, opt, state.rates);
const targetSellPrice = (cashOut, shares, opt, pct) => FE.targetSellPrice(state.market, cashOut, shares, opt, state.rates, pct);
const MSG_INVALID = "Some inputs are invalid — use positive numbers only.";
const DRAG_LOW = 0.5, DRAG_HIGH = 1;   // % of trade value
const maxShares = (budget, price, opt, step, maxQty) => FE.maxSharesForBudget(state.market, budget, price, opt, state.rates, step, maxQty);

/* ---------- Formatting ---------- */
const cur = () => state.market === "us" ? "$" : "RM";
function fmt(n, min, max){ return Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: min, maximumFractionDigits: max ?? min }); }
function money(n){ const s = n < 0 ? "−" : ""; return s + cur() + fmt(Math.abs(n), 2); }
function signed(n){ return (n > 0 ? "+" : "") + money(n); }
function price(n){ return cur() + fmt(n, state.market === "us" && n >= 1 ? 2 : 3, 4); }
function qtyFmt(n){ return fmt(n, 0, 4); }
function plural(n, word){ return `${qtyFmt(n)} ${word}${n === 1 ? "" : "s"}`; }
function signPct(n){ return `${n >= 0 ? "+" : ""}${fmt(n, 2)}%`; }
function pnlClass(n){
  if(n > 0) return "pos";
  if(n < 0) return "neg";
  return "hl";
}
const isPos = FE.isPos;
const hasFx = opt => state.market !== "us" || isPos(opt.fx);

/* ---------- Row definitions ---------- */
function rowDefs(){
  const r = state.rates[state.market];
  if(state.market === "bursa"){
    const t = $("bursaType").value;
    return [
      ["commission","Brokerage", `${r.commPct}%, rounded to nearest sen${$("promo").checked ? " · promo 0%" : ""}`],
      ["platform","Platform fee", `RM${fmt(r.platform,2)} per order`],
      ["clearing","Clearing fee", `${r.clearPct}%, rounded up, max RM${fmt(r.clearCap,0)}`],
      ["stamp","Stamp duty", t === "etf" ? "ETF exempt (to 31 Dec 2028)" : `RM${r.stampPer1k} per RM1,000 or part, max RM${fmt(r.stampCap,0)}`],
      ...(FE.SST_BURSA.includes(t) ? [["sst","SST", `${r.sstPct}% on brokerage, platform & clearing`]] : [])
    ];
  }
  const rows = [
    ["commission","Commission", `${r.commPct}% of value · none if <1 share${$("promo").checked ? " · promo 0%" : ""}`],
    ["platform","Platform fee", `$${r.platform}/order · <1 share: ${r.fracPlatPct}%, max $${r.fracPlatCap}`],
    ["settlement","Settlement fee", `$${r.settle}/share, max ${r.settleCapPct}% of value`],
    ["sec","SEC fee", `Sell only · $${r.secPerM}/$1m, min $${r.secMin}`],
    ["taf","FINRA TAF", `Sell only · $${r.taf}/share, max $${r.tafMax}`],
    ["cat","CAT fee", $("usType").value === "otc" ? `OTC stock · $${r.catOtc}/share` : `NYSE/Nasdaq (NMS) · $${r.catNms}/share`],
    ["stamp","MY stamp duty", `RM${r.stampPer1k} per RM1,000 or part, max RM${fmt(r.stampCap,0)}, at FX`]
  ];
  if($("usSst").checked) rows.push(["sst","SST", `${r.sstPct}% on commission & platform`]);
  return rows;
}

function el(tag, cls, text){
  const e = document.createElement(tag);
  if(cls) e.className = cls;
  if(text != null) e.textContent = text;
  return e;
}
function labelCell(label, note){
  const td = el("td"); td.append(label);
  if(note){ const s = el("small", null, note); td.append(s); }
  return td;
}
function valCell(v, active){
  return active ? el("td", null, money(v)) : el("td", "na", "—");
}

/** Buy-only fee table: trade value, each applicable fee (no SEC/TAF on buys), total. */
function renderBuyFeeTable(bodyId, value, f, has){
  const body = $(bodyId);
  const rows = [[labelCell("Trade value"), valCell(value, has)]];
  for(const [key, label, note] of rowDefs()){
    if(key !== "sec" && key !== "taf") rows.push([labelCell(label, note), valCell(f.lines[key] || 0, has)]);
  }
  body.replaceChildren(...rows.map(cells => { const tr = el("tr"); tr.append(...cells); return tr; }));
  const trT = el("tr", "sum"); trT.append(labelCell("Total fees"), valCell(f.total, has)); body.append(trT);
}

/* ---------- Calculators ---------- */
function options(){
  const fx = readNum("fx");
  return {
    promo: $("promo").checked,
    type: $("bursaType").value,
    usType: $("usType").value,
    usSst: $("usSst").checked,
    fx: fx.v
  };
}

function calcTrade(opt){
  const bp = readNum("buyPrice"), q = readNum("qty"), sp = readNum("sellPrice"), tp = readNum("targetPct");
  const shares = q.v;
  const buyValue = round2(bp.v * shares);
  const hasBuy = buyValue > 0;
  const hasSell = sp.v > 0 && shares > 0;
  const sellValue = hasSell ? round2(sp.v * shares) : 0;
  const bf = fees(buyValue, shares, "buy", opt);
  const sf = hasSell ? fees(sellValue, shares, "sell", opt) : { lines: {}, total: 0 };
  const t = { shares, buyValue, sellValue, hasBuy, hasSell, bf, sf,
              cashOut: round2(buyValue + bf.total), netIn: round2(sellValue - sf.total) };

  renderTradeTable(t);
  renderPnl(t);
  renderBreakEven(t, bp.v, opt);
  renderTarget(hasBuy, t.cashOut, shares, bp.v, tp.v, opt);
  renderDrag("", bp.v, shares, opt);
  renderTradeHints(shares, opt, [bp, q, sp, tp].every(x => x.ok));
}

function renderTradeTable(t){
  const body = $("tradeRows");
  const rows = [["", "Trade value", null, valCell(t.buyValue, t.hasBuy), valCell(t.sellValue, t.hasSell)]];
  for(const [key, label, note] of rowDefs()){
    const buyCell = key === "sec" || key === "taf" ? el("td", "na", "—") : valCell(t.bf.lines[key] || 0, t.hasBuy);
    rows.push(["", label, note, buyCell, valCell(t.sf.lines[key] || 0, t.hasSell)]);
  }
  rows.push(["sum", "Total fees", null, valCell(t.bf.total, t.hasBuy), valCell(t.sf.total, t.hasSell)]);
  rows.push(["grand", "Cash out / Net in", null, valCell(t.cashOut, t.hasBuy), valCell(t.netIn, t.hasSell)]);
  body.replaceChildren(...rows.map(([cls, label, note, a, b]) => {
    const tr = el("tr", cls || null); tr.append(labelCell(label, note), a, b); return tr;
  }));
}

function renderPnl(t){
  $("vCash").textContent = t.hasBuy ? money(t.cashOut) : "—";
  $("vNet").textContent  = t.hasSell ? money(t.netIn) : "—";
  const tile = $("tPnl");
  tile.className = "tile main";
  if(!(t.hasBuy && t.hasSell)){
    $("vPnl").textContent = "—";
    $("tRet").textContent = t.hasBuy ? "Enter a sell price" : "Enter buy price and quantity";
    return;
  }
  const pnl = round2(t.netIn - t.cashOut);
  const gross = round2(t.sellValue - t.buyValue);
  $("vPnl").textContent = signed(pnl);
  $("tRet").textContent = `${signPct(pnl / t.cashOut * 100)} · gross ${signed(gross)} · fees ${money(t.bf.total + t.sf.total)}`;
  tile.classList.add(pnlClass(pnl));
}

function renderBreakEven(t, buyPrice, opt){
  const be = t.hasBuy ? breakEven(t.cashOut, t.shares, opt) : 0;
  $("vBe").textContent = be ? price(be) : "—";
  $("sBe").textContent = be
    ? `Min. tradable: ${price(roundUpTick(be))} · +${fmt((be / buyPrice - 1) * 100, 2)}% from buy`
    : "Covers buy + sell fees";
}

function qtyHint(shares){
  if(state.market === "bursa") return shares > 0 ? `${plural(shares / 100, "lot")} · 1 lot = 100` : "1 lot = 100 shares";
  return shares > 0 && shares < 1 ? "Fractional order (< 1 share)" : "Fractional allowed";
}

function renderTradeHints(shares, opt, inputsOk){
  $("qtyHint").textContent = qtyHint(shares);
  const us = state.market === "us";
  const notes = [];
  if(!us && shares > 0 && shares % 100 !== 0) notes.push("Bursa normal board trades in lots of 100; odd lots go to the odd-lot market.");
  if(!hasFx(opt)) notes.push("Enter a valid USD/MYR rate — Malaysian stamp duty on US trades cannot be computed without it.");
  if(us && shares > 0 && shares < 1) notes.push("Order < 1 share: no commission; platform fee is % based (max $0.99); settlement, SEC and TAF are not charged.");
  if(!inputsOk) notes.push(MSG_INVALID);
  showNote("tradeNote", notes, !hasFx(opt) || !inputsOk);
}

/** Target sell price tile: exact solve, then the tradable (tick-rounded) price and the net result at that price. */
function renderTarget(hasBuy, cashOut, shares, buyPrice, pct, opt){
  const tile = $("tTarget");
  tile.hidden = !(hasBuy && pct > 0);
  if(tile.hidden) return;
  $("kTarget").textContent = `Target sell price · +${fmt(pct, 0, 2)}% net`;
  const exact = targetSellPrice(cashOut, shares, opt, pct);
  if(!exact){ $("vTarget").textContent = "—"; $("sTarget").textContent = "Not reachable"; return; }
  const tick = roundUpTick(exact);
  const value = round2(tick * shares);
  const pnl = round2(value - fees(value, shares, "sell", opt).total - cashOut);
  $("vTarget").textContent = price(tick);
  $("sTarget").textContent = `Net ${signed(pnl)} (${signPct(pnl / cashOut * 100)}) at this price · +${fmt((tick / buyPrice - 1) * 100, 2)}% from buy · exact ${price(exact)}`;
}

function calcAvg(opt){
  const ca = readNum("curAvg"), cq = readNum("curQty"), np = readNum("addPrice"), aq = readNum("addQty");
  const curCost = round2(ca.v * cq.v);
  const addValue = round2(np.v * aq.v);
  const f = fees(addValue, aq.v, "buy", opt);
  const addCash = round2(addValue + f.total);
  const totQty = cq.v + aq.v;
  const totCost = round2(curCost + addCash);

  $("vCurCost").textContent = curCost > 0 ? money(curCost) : "—";
  $("vAddCash").textContent = addValue > 0 ? money(addCash) : "—";
  $("vTotQty").textContent = qtyFmt(totQty);
  $("vTotCost").textContent = totCost > 0 ? money(totCost) : "—";
  renderNewAverage(totQty > 0 && totCost > 0 ? totCost / totQty : 0, ca.v, np.v);
  renderBuyFeeTable("avgRows", addValue, f, addValue > 0);

  const notes = ["Enter your current average as shown in Moomoo (it already includes past buy fees if you use \"average cost\")."];
  const bad = ![ca, cq, np, aq].every(x => x.ok);
  if(bad) notes.unshift(MSG_INVALID);
  if(!hasFx(opt)) notes.unshift("Enter a valid USD/MYR rate for stamp duty.");
  showNote("avgNote", notes, bad || !hasFx(opt));
}

/** New average tile. Green when the average sits below the new buy price (≈ market): the position is in profit there. */
function renderNewAverage(avg, curAvg, newPrice){
  if(!avg){
    $("tAvg").className = "tile main hl";
    $("vAvg").textContent = "—"; $("sAvg").textContent = "Incl. new buy fees";
    return;
  }
  $("vAvg").textContent = price(avg);
  $("tAvg").className = "tile main " + (newPrice > 0 && avg < newPrice ? "pos" : "hl");
  const parts = [];
  if(curAvg > 0) parts.push(`${avg <= curAvg ? "▼" : "▲"} ${fmt(Math.abs(avg / curAvg - 1) * 100, 2)}% vs current avg`);
  if(newPrice > 0){
    const g = (newPrice / avg - 1) * 100;
    parts.push(`position ${g >= 0 ? "+" : "−"}${fmt(Math.abs(g), 2)}% at new buy price`);
  }
  parts.push("incl. new buy fees");
  $("sAvg").textContent = parts.join(" · ");
}

/**
 * Fee drag card: round-trip fees (buy now + sell later at the same price) as % of the trade.
 * Green <= 0.5%, amber <= 1%, red above; when above 1%, suggests the smallest order that gets under it.
 */
function renderDrag(prefix, price, shares, opt){
  const tile = $("t" + prefix + "Drag");
  const rt = FE.roundTripFees(state.market, price, shares, opt, state.rates);
  tile.hidden = !isPos(rt.value);
  if(tile.hidden) return;
  const [level, cls] = dragLevel(rt.pct);
  tile.className = "tile full " + cls;
  $("k" + prefix + "Drag").textContent = `Fee drag · ${level}`;
  $("v" + prefix + "Drag").textContent = `${fmt(rt.pct, 2)}% · ${money(rt.total)}`;
  const parts = [`Buy + sell fees on ${money(rt.value)}; price must rise ${fmt(rt.pct, 2)}% just to cover them`];
  if(rt.pct > DRAG_HIGH) parts.push(...dragSuggestion(price, shares, opt));
  $("s" + prefix + "Drag").textContent = parts.join(" · ");
}

function dragLevel(pct){
  if(pct <= DRAG_LOW) return ["Low", "pos"];
  if(pct <= DRAG_HIGH) return ["Moderate", "warn"];
  return ["High", "neg"];
}

/** Smallest order (Bursa lots / US whole shares) that brings fee drag under DRAG_HIGH. */
function dragSuggestion(price, shares, opt){
  const bursa = state.market === "bursa";
  const minQ = FE.minOrderForDrag(state.market, price, opt, state.rates, bursa ? 100 : 1, DRAG_HIGH);
  if(!minQ) return [`fees stay above ${DRAG_HIGH}% at this price`];
  if(minQ <= shares) return [];
  const size = bursa ? plural(minQ / 100, "lot") : plural(minQ, "share");
  return [`buy at least ${size} (${money(round2(minQ * price))}) to keep fees under ${DRAG_HIGH}%`];
}

/** Shares for a budget: Bursa in board lots of 100, US in whole shares, US fractional if under one share. */
function calcBudget(opt){
  const b = readNum("budgetAmt"), p = readNum("budgetPrice");
  const bursa = state.market === "bursa";
  const ready = isPos(b.v) && isPos(p.v);
  const { r, frac } = budgetResult(b.v, p.v, opt, bursa, ready);
  const got = r.shares > 0;

  renderBudgetHeadline(r, frac, bursa, ready);
  $("vBudCost").textContent = got ? money(r.cost) : "—";
  $("vBudLeft").textContent = ready ? money(r.left) : "—";
  renderDrag("Bud", got ? p.v : 0, r.shares, opt);
  renderBudgetNext(r, frac, bursa, ready);
  renderBuyFeeTable("budgetRows", r.value, r.fees, got);

  const notes = [];
  const bad = ![b, p].every(x => x.ok);
  if(bad) notes.push(MSG_INVALID);
  if(!hasFx(opt)) notes.push("Enter a valid USD/MYR rate for stamp duty.");
  if(bursa) notes.push("Bursa normal board trades in lots of 100 shares.");
  if(frac) notes.push("Budget is under one share, so this is a fractional order (no commission, % platform fee). Check the app for any minimum order size.");
  showNote("budgetNote", notes, bad || !hasFx(opt));
}

/** Bursa in board lots of 100; US in whole shares, falling back to a fractional order below one share. */
function budgetResult(budget, px, opt, bursa, ready){
  const whole = maxShares(budget, px, opt, bursa ? 100 : 1);
  if(bursa || whole.shares > 0 || !ready) return { r: whole, frac: false };
  const fr = maxShares(budget, px, opt, 0.0001, 0.9999);
  return fr.shares > 0 ? { r: fr, frac: true } : { r: whole, frac: false };
}

function budgetQty(r, frac, bursa){
  if(bursa) return plural(r.shares / 100, "lot");
  if(frac) return `${fmt(r.shares, 4)} share`;
  return plural(r.shares, "share");
}

function renderBudgetHeadline(r, frac, bursa, ready){
  const got = r.shares > 0;
  $("tBudget").className = "tile main " + (got ? "pos" : "hl");
  let v = "—", sub = "Enter budget and buy price";
  if(ready && got){
    v = budgetQty(r, frac, bursa);
    if(bursa) sub = `${qtyFmt(r.shares)} shares · fees included`;
    else sub = frac ? "Fractional order · fees included" : "Whole shares · fees included";
  }else if(ready){
    v = bursa ? "0 lots" : "0 shares";
    sub = "Budget too small for one " + (bursa ? "lot" : "share");
  }
  $("vBudget").textContent = v;
  $("sBudget").textContent = sub;
}

function renderBudgetNext(r, frac, bursa, ready){
  $("tBudNext").hidden = frac;
  const show = ready && r.nextShortfall > 0;
  $("kBudNext").textContent = bursa ? "Next lot needs" : "Next share needs";
  $("vBudNext").textContent = show ? "+" + money(r.nextShortfall) : "—";
  const unit = bursa ? "100 more shares" : "1 more share";
  $("sBudNext").textContent = show ? `More cash for ${unit}, fees included` : "Extra cash for one more";
}

function showNote(id, notes, warn){
  const n = $(id);
  n.hidden = notes.length === 0;
  n.classList.toggle("warn", !!warn);
  n.textContent = notes.join(" ");
}

/* ---------- Rules & editable rates ---------- */
function renderRules(){
  const r = state.rates[state.market];
  const items = state.market === "bursa" ? [
    `Brokerage ${r.commPct}% of value, rounded to the nearest sen, no minimum.`,
    `Platform fee RM${fmt(r.platform,2)} per executed order.`,
    `Clearing fee ${r.clearPct}% of value, rounded up to the next sen, capped at RM${fmt(r.clearCap,0)}.`,
    `Stamp duty RM${r.stampPer1k} per RM1,000 or part thereof, capped at RM${fmt(r.stampCap,0)}. Bursa-listed ETFs exempt until 31 Dec 2028.`,
    `SST ${r.sstPct}% (from 1 Oct 2025) on brokerage, platform and clearing fees for ETFs, REITs, warrants, rights, business trusts and stapled securities. Ordinary shares exempt.`,
    `Fees are identical on buy and sell.`
  ] : [
    `Commission ${r.commPct}% of value. Platform fee $${r.platform} per order.`,
    `Orders under 1 share: no commission; platform fee ${r.fracPlatPct}% of value, max $${r.fracPlatCap}; no settlement, SEC or TAF.`,
    `Settlement $${r.settle}/share, capped at ${r.settleCapPct}% of value (buy and sell).`,
    `SEC fee (sell only) $${r.secPerM} per $1m sold, min $${r.secMin} — resumed 4 Apr 2026.`,
    `FINRA TAF (sell only) $${r.taf}/share, min $${r.tafMin}, max $${r.tafMax}.`,
    `CAT fee (buy and sell) per share: NYSE/Nasdaq-listed (NMS) $${r.catNms}; over-the-counter (OTC) $${r.catOtc}.`,
    `Malaysian stamp duty RM${r.stampPer1k} per RM1,000 or part, max RM${fmt(r.stampCap,0)}, computed in MYR and charged in USD. FX auto-fills from the ECB reference rate (Frankfurter); Moomoo uses its own rate, so small differences are possible.`,
    `SST is not applied by default; tick "Add 8% SST" if your contract note shows it.`
  ];
  const ul = $("rules"); ul.replaceChildren(...items.map(t => el("li", null, t)));

  const box = $("rateFields"); box.replaceChildren();
  for(const [key, label] of RATE_FIELDS[state.market]){
    const wrap = el("div");
    const id = "rate_" + key;
    const lab = el("label", null, label); lab.htmlFor = id;
    const inp = el("input"); inp.id = id; inp.inputMode = "decimal"; inp.autocomplete = "off";
    inp.value = String(r[key]);
    inp.addEventListener("input", () => {
      const raw = inp.value.trim();
      const v = Number(raw);
      const ok = raw !== "" && Number.isFinite(v) && v >= 0;
      inp.classList.toggle("bad", !ok);
      if(ok){ state.rates[state.market][key] = v; update(false); }
    });
    wrap.append(lab, inp); box.append(wrap);
  }
}

/* ---------- UI wiring ---------- */
function applyMode(){
  const us = state.market === "us";
  document.querySelectorAll("[data-market]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.market === state.market)));
  document.querySelectorAll("[data-calc]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.calc === state.calc)));
  $("pTrade").hidden = state.calc !== "trade";
  $("pAvg").hidden = state.calc !== "avg";
  $("pBudget").hidden = state.calc !== "budget";
  $("optBursa").hidden = us;
  $("optUsType").hidden = !us;
  $("optUsFx").hidden = !us;
  $("usSstWrap").hidden = !us;
  const c = us ? "USD" : "RM";
  document.querySelectorAll("label.cur").forEach(l => {
    l.textContent = l.textContent.replace(/ \((RM|USD)\)/, "").replace(/( \(optional\))?$/, m => ` (${c})${m}`);
  });
  ["buyPrice","sellPrice","curAvg","addPrice"].forEach(id => $(id).placeholder = us ? "0.00" : "0.000");
}

function update(rerenderRules = true){
  if(rerenderRules) renderRules();
  const opt = options();
  calcTrade(opt);
  calcAvg(opt);
  calcBudget(opt);
  save();
}

document.querySelectorAll("[data-market]").forEach(b => b.addEventListener("click", () => {
  if(state.market === b.dataset.market) return;
  state.market = b.dataset.market;
  // Prices are market-specific; clear them to avoid mixing RM and USD.
  ["buyPrice","sellPrice","qty","curAvg","curQty","addPrice","addQty","budgetAmt","budgetPrice"].forEach(id => { $(id).value = ""; $(id).classList.remove("bad"); });
  applyMode(); update();
}));
document.querySelectorAll("[data-calc]").forEach(b => b.addEventListener("click", () => {
  state.calc = b.dataset.calc; applyMode(); update(false);
}));
["buyPrice","qty","sellPrice","targetPct","curAvg","curQty","addPrice","addQty","budgetAmt","budgetPrice"].forEach(id => $(id).addEventListener("input", () => update(false)));
$("fx").addEventListener("input", () => { fx.mode = "manual"; showFxState(); update(false); });
$("fxRefresh").addEventListener("click", () => { fx.mode = "live"; fetchFx(true); });
["bursaType","usType","promo","usSst"].forEach(id => $(id).addEventListener("change", () => update()));
$("resetRates").addEventListener("click", () => { state.rates[state.market] = clone(DEFAULTS[state.market]); update(); });

load();
applyMode();
update();
showFxState();
if(fx.mode === "live") fetchFx(false);

// Offline support. Registration failure (e.g. file://) is harmless.
if("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")){
  navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(() => {});
}
})();
