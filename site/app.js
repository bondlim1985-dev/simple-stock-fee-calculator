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
  try{
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if(!s) return;
    if(s.market === "bursa" || s.market === "us") state.market = s.market;
    if(s.calc === "trade" || s.calc === "avg") state.calc = s.calc;
    for(const m of ["bursa","us"]) for(const k in DEFAULTS[m]){
      const v = s.rates && s.rates[m] && s.rates[m][k];
      if(typeof v === "number" && Number.isFinite(v) && v >= 0) state.rates[m][k] = v;
    }
    if(typeof s.fx === "string") $("fx").value = s.fx;
    if(typeof s.targetPct === "string" && /^\d{0,4}(\.\d{0,2})?$/.test(s.targetPct)) $("targetPct").value = s.targetPct;
    if(s.fxMode === "manual" || s.fxMode === "live") fx.mode = s.fxMode;
    if(s.fxLive && validFx(s.fxLive.rate) && typeof s.fxLive.date === "string" && typeof s.fxLive.at === "number") fx.live = s.fxLive;
    if(typeof s.bursaType === "string" && $("bursaType").querySelector(`option[value="${CSS.escape(s.bursaType)}"]`)) $("bursaType").value = s.bursaType;
    if(s.usType === "nms" || s.usType === "otc") $("usType").value = s.usType;
    $("promo").checked = !!s.promo;
    $("usSst").checked = !!s.usSst;
  }catch(_){ /* storage unavailable or corrupt: use defaults */ }
}
function save(){
  try{
    localStorage.setItem(STORE_KEY, JSON.stringify({
      market: state.market, calc: state.calc, rates: state.rates,
      fx: $("fx").value, targetPct: $("targetPct").value, bursaType: $("bursaType").value, usType: $("usType").value,
      promo: $("promo").checked, usSst: $("usSst").checked,
      fxMode: fx.mode, fxLive: fx.live
    }));
  }catch(_){}
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
  if(fx.busy) return fxStatus("Fetching live rate…");
  if(fx.mode === "manual") return fxStatus("Manual rate — tap Live to use the market rate");
  if(fx.live) return fxStatus(`ECB reference rate · ${fxDateLabel(fx.live.date)}`, "ok");
  fxStatus("Default rate — tap Live to fetch");
}
async function fetchFx(force){
  if(fx.busy) return;
  if(!force && fx.live && Date.now() - fx.live.at < FX_TTL_MS){
    if(fx.mode === "live"){ $("fx").value = fx.live.rate.toFixed(4); update(false); }
    return showFxState();
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
  }catch(_){
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
  const ok = /^\d*\.?\d+$|^\d+\.$/.test(raw);
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

/* ---------- Formatting ---------- */
const cur = () => state.market === "us" ? "$" : "RM";
function fmt(n, min, max){ return Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: min, maximumFractionDigits: max ?? min }); }
function money(n){ const s = n < 0 ? "−" : ""; return s + cur() + fmt(Math.abs(n), 2); }
function signed(n){ return (n > 0 ? "+" : "") + money(n); }
function price(n){ return cur() + fmt(n, state.market === "us" && n >= 1 ? 2 : 3, 4); }
function qtyFmt(n){ return fmt(n, 0, 4); }

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

function el(tag, cls, text){ const e = document.createElement(tag); if(cls) e.className = cls; if(text != null) e.textContent = text; return e; }
function labelCell(label, note){
  const td = el("td"); td.append(label);
  if(note){ const s = el("small", null, note); td.append(s); }
  return td;
}
function valCell(v, active){
  return active ? el("td", null, money(v)) : el("td", "na", "—");
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
  const cashOut = round2(buyValue + bf.total);
  const netIn = round2(sellValue - sf.total);

  // Table
  const body = $("tradeRows"); body.replaceChildren();
  const trV = el("tr"); trV.append(labelCell("Trade value"), valCell(buyValue, hasBuy), valCell(sellValue, hasSell)); body.append(trV);
  for(const [key, label, note] of rowDefs()){
    const tr = el("tr");
    const buyApplies = !(key === "sec" || key === "taf");
    tr.append(labelCell(label, note),
      buyApplies ? valCell(bf.lines[key] || 0, hasBuy) : el("td", "na", "—"),
      valCell(sf.lines[key] || 0, hasSell));
    body.append(tr);
  }
  const trT = el("tr", "sum"); trT.append(labelCell("Total fees"), valCell(bf.total, hasBuy), valCell(sf.total, hasSell)); body.append(trT);
  const trG = el("tr", "grand"); trG.append(labelCell("Cash out / Net in"), valCell(cashOut, hasBuy), valCell(netIn, hasSell)); body.append(trG);

  // Tiles
  $("vCash").textContent = hasBuy ? money(cashOut) : "—";
  $("vNet").textContent  = hasSell ? money(netIn) : "—";
  const tile = $("tPnl");
  tile.className = "tile main";
  if(hasBuy && hasSell){
    const pnl = round2(netIn - cashOut);
    const gross = round2(sellValue - buyValue);
    $("vPnl").textContent = signed(pnl);
    $("tRet").textContent = `${pnl >= 0 ? "+" : ""}${fmt(pnl / cashOut * 100, 2)}% · gross ${signed(gross)} · fees ${money(bf.total + sf.total)}`;
    tile.classList.add(pnl > 0 ? "pos" : pnl < 0 ? "neg" : "hl");
  }else{
    $("vPnl").textContent = "—";
    $("tRet").textContent = hasBuy ? "Enter a sell price" : "Enter buy price and quantity";
  }
  if(hasBuy){
    const be = breakEven(cashOut, shares, opt);
    $("vBe").textContent = be ? price(be) : "—";
    $("sBe").textContent = be ? `Min. tradable: ${price(roundUpTick(be))} · +${fmt((be / bp.v - 1) * 100, 2)}% from buy` : "Covers buy + sell fees";
  }else{
    $("vBe").textContent = "—"; $("sBe").textContent = "Covers buy + sell fees";
  }
  renderTarget(hasBuy, cashOut, shares, bp.v, tp.v, opt);

  // Hints / warnings
  $("qtyHint").textContent = state.market === "bursa"
    ? (shares > 0 ? `${qtyFmt(shares / 100)} lot${shares === 100 ? "" : "s"} · 1 lot = 100` : "1 lot = 100 shares")
    : (shares > 0 && shares < 1 ? "Fractional order (< 1 share)" : "Fractional allowed");
  const notes = [];
  if(state.market === "bursa" && shares > 0 && shares % 100 !== 0) notes.push("Bursa normal board trades in lots of 100; odd lots go to the odd-lot market.");
  if(state.market === "us" && !(opt.fx > 0)) notes.push("Enter a valid USD/MYR rate — Malaysian stamp duty on US trades cannot be computed without it.");
  if(state.market === "us" && shares > 0 && shares < 1) notes.push("Order < 1 share: no commission; platform fee is % based (max $0.99); settlement, SEC and TAF are not charged.");
  if(![bp, q, sp, tp].every(x => x.ok)) notes.push("Some inputs are invalid — use positive numbers only.");
  showNote("tradeNote", notes, state.market === "us" && !(opt.fx > 0) || ![bp, q, sp, tp].every(x => x.ok));
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
  $("sTarget").textContent = `Net ${signed(pnl)} (${pnl >= 0 ? "+" : ""}${fmt(pnl / cashOut * 100, 2)}%) at this price · +${fmt((tick / buyPrice - 1) * 100, 2)}% from buy · exact ${price(exact)}`;
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
  if(totQty > 0 && totCost > 0){
    const avg = totCost / totQty;
    $("vAvg").textContent = price(avg);
    // Green when the new average sits below the new buy price (≈ market): the whole position is in profit at that price.
    const inProfit = np.v > 0 && avg < np.v;
    $("tAvg").className = "tile main " + (inProfit ? "pos" : "hl");
    const parts = [];
    if(ca.v > 0) parts.push(`${avg <= ca.v ? "▼" : "▲"} ${fmt(Math.abs(avg / ca.v - 1) * 100, 2)}% vs current avg`);
    if(np.v > 0) { const g = (np.v / avg - 1) * 100; parts.push(`position ${g >= 0 ? "+" : "−"}${fmt(Math.abs(g), 2)}% at new buy price`); }
    parts.push("incl. new buy fees");
    $("sAvg").textContent = parts.join(" · ");
  }else{
    $("tAvg").className = "tile main hl";
    $("vAvg").textContent = "—"; $("sAvg").textContent = "Incl. new buy fees";
  }

  const body = $("avgRows"); body.replaceChildren();
  const has = addValue > 0;
  const trV = el("tr"); trV.append(labelCell("Trade value"), valCell(addValue, has)); body.append(trV);
  for(const [key, label, note] of rowDefs()){
    if(key === "sec" || key === "taf") continue;
    const tr = el("tr"); tr.append(labelCell(label, note), valCell(f.lines[key] || 0, has)); body.append(tr);
  }
  const trT = el("tr", "sum"); trT.append(labelCell("Total fees"), valCell(f.total, has)); body.append(trT);

  const notes = ["Enter your current average as shown in Moomoo (it already includes past buy fees if you use \"average cost\")."];
  const bad = ![ca, cq, np, aq].every(x => x.ok);
  if(bad) notes.unshift("Some inputs are invalid — use positive numbers only.");
  if(state.market === "us" && !(opt.fx > 0)) notes.unshift("Enter a valid USD/MYR rate for stamp duty.");
  showNote("avgNote", notes, bad || (state.market === "us" && !(opt.fx > 0)));
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
  save();
}

document.querySelectorAll("[data-market]").forEach(b => b.addEventListener("click", () => {
  if(state.market === b.dataset.market) return;
  state.market = b.dataset.market;
  // Prices are market-specific; clear them to avoid mixing RM and USD.
  ["buyPrice","sellPrice","qty","curAvg","curQty","addPrice","addQty"].forEach(id => { $(id).value = ""; $(id).classList.remove("bad"); });
  applyMode(); update();
}));
document.querySelectorAll("[data-calc]").forEach(b => b.addEventListener("click", () => {
  state.calc = b.dataset.calc; applyMode(); update(false);
}));
["buyPrice","qty","sellPrice","targetPct","curAvg","curQty","addPrice","addQty"].forEach(id => $(id).addEventListener("input", () => update(false)));
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
