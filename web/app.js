"use strict";
/* The Market Maker's Dilemma: front end.
   This file only DRAWS what the server sends. All rules and numbers come from the
   Python engine through /api. The server never sends hidden information (true value,
   trader types) before settlement. Needs flap.js and arena.js loaded first. */

const GITHUB = "https://github.com/andiejburrow/market-makers-dilemma";
const DEFAULT = { bid: 30, ask: 70 };
const MINUS = "−";
let INK, GREEN, RED, AMBER, BLUE, GRID, AXIS, BG;
function readColors() { INK = V("--ink"); GREEN = V("--buy"); RED = V("--sell"); AMBER = V("--amber"); BLUE = V("--blue"); GRID = V("--grid"); AXIS = V("--axis"); BG = V("--bg"); }
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sgn = (x, dp = 2) => (x < -0.004 ? MINUS : "+") + Math.abs(x).toFixed(dp);
const num = (x, dp = 2) => x.toFixed(dp);
const px = x => (Number.isInteger(x) ? String(x) : x.toFixed(2));
const pct = x => Math.round(x * 100) + "%";
const tone = x => (x > 0.004 ? "pos" : x < -0.004 ? "neg" : "");
const pill = d => `<span class="pill ${d === "BUY" ? "buy" : "sell"}">${d === "BUY" ? "Buy" : "Sell"}</span>`;
const who = f => `<span class="${f === "you" ? "you" : "riv"}">${f === "you" ? "You" : "Rival"}</span>`;

let CFG = { alpha: 0.2, n_arrivals: 10, rounds: 10, delta: 2, tick: 1 };
let D = null, view = "home", quotes = { ...DEFAULT }, err = "", busy = false;
const UI = {}, PREV = {}, CHARTS = {};
let cid = 0, revealedKey = null, tapeKey = null, REPLAY = { k: 0, timer: null };

/* ------------------------------------------------------------------ api */
async function call(name, body = {}) {
  const r = await fetch("/api/" + name, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Something went wrong. Try again.");
  return j;
}
async function act(fn) {
  if (busy) return;
  busy = true; document.body.classList.add("busy");
  try { err = ""; await fn(); } catch (e) { err = e.message; }
  busy = false; document.body.classList.remove("busy");
  render();
}
const startGame = mode => act(async () => { D = await call("start", { mode }); quotes = { ...DEFAULT }; view = "play"; tapeKey = null; window.scrollTo(0, 0); });
const lockQuotes = () => {
  if (!D || D.finished || view !== "play") return;
  return act(async () => {
    const res = await call("lock", { sid: D.sid, bid: quotes.bid, ask: quotes.ask });
    await UI.arena.playFill(res.last, res.tape);
    D = res; quotes = { ...DEFAULT };
  });
};
const toReview = () => { const el = document.querySelector(".review"); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 84, behavior: "smooth" }); };
const settle = async () => { await act(async () => { D = await call("settle", { sid: D.sid }); }); if (D && D.review) setTimeout(toReview, 650); };
const nextRound = () => act(async () => { D = await call("next", { sid: D.sid }); quotes = { ...DEFAULT }; tapeKey = null; window.scrollTo(0, 0); });
const go = v => { view = v; err = ""; render(); window.scrollTo(0, 0); };

/* --------------------------------------------------------------- charts */
function niceRange(lo, hi) {
  if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
  const raw = (hi - lo) / 4, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
  const a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step;
  const ticks = [];
  for (let v = a; v <= b + step / 2; v += step) ticks.push(+v.toFixed(10));
  return { lo: a, hi: b, ticks };
}
const fixedRange = (lo, hi) => ({ lo, hi, ticks: [0, 1, 2, 3, 4].map(i => lo + (hi - lo) * i / 4) });
const tickLabel = t => (Math.abs(t) < 1e-9 ? "0" : (Math.abs(t) >= 10 ? String(Math.round(t)) : String(+t.toFixed(1))).replace("-", MINUS));

function frame(h, r, labels, xAt, W) {
  const m = { l: 48, r: 62, t: 12, b: 30 };
  const y = v => m.t + (r.hi - v) * (h - m.t - m.b) / (r.hi - r.lo);
  let g = "";
  r.ticks.forEach(t => {
    g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}" stroke="${Math.abs(t) < 1e-9 ? AXIS : GRID}" stroke-width="1"/>`;
    g += `<text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${tickLabel(t)}</text>`;
  });
  labels.forEach((lab, i) => { g += `<text x="${xAt(i)}" y="${h - 9}" text-anchor="middle">${esc(lab)}</text>`; });
  return { m, y, g };
}
function overlay(id, W, h) {
  return `<line class="xh" y1="8" y2="${h - 28}" x1="0" x2="0"/><rect class="hit" x="0" y="0" width="${W}" height="${h}" fill="transparent"/>`;
}
const fmtEnd = (v, s) => (s.pct ? Math.round(v) + "%" : (v < -0.004 ? MINUS : v > 0.004 ? "+" : "") + Math.abs(v).toFixed(2));
function lineChart({ series, labels, range, h = 230, label, W = 640, area = false, gap = false }) {
  const all = series.flatMap(s => s.values);
  const r = range || niceRange(Math.min(0, ...all), Math.max(0, ...all));
  const n = labels.length, m = { l: 48, r: 62 };
  const xAt = i => m.l + (n === 1 ? 0 : i * (W - m.l - m.r) / (n - 1));
  const f = frame(h, r, labels, xAt, W);
  const id = "c" + (++cid);
  CHARTS[id] = { W, labels, series, xs: labels.map((_, i) => xAt(i)), fmt: v => (v < -0.004 ? MINUS : "") + Math.abs(v).toFixed(1) };
  let body = "", defs = "", usedY = [];
  const base = f.y(Math.max(r.lo, Math.min(r.hi, 0)));
  const ptsOf = s => s.values.map((v, i) => `${i ? "L" : "M"}${xAt(i).toFixed(1)},${f.y(v).toFixed(1)}`).join(" ");
  if (gap && series.length > 1) {
    const A = series[0].values, B = series[1].values, up = B[B.length - 1] >= A[A.length - 1];
    const fwd = B.map((v, i) => `${i ? "L" : "M"}${xAt(i).toFixed(1)},${f.y(v).toFixed(1)}`).join(" ");
    const back = A.map((v, i) => `L${xAt(i).toFixed(1)},${f.y(v).toFixed(1)}`).reverse().join(" ");
    body += `<path class="fade" d="${fwd} ${back} Z" fill="${up ? GREEN : RED}" opacity=".20"/>`;
  }
  series.forEach((s, si) => {
    const pts = ptsOf(s);
    if (area && !s.dash) {
      defs += `<linearGradient id="${id}g${si}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity=".34"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient>`;
      const n1 = s.values.length - 1;
      body += `<path class="fade" d="${pts} L${xAt(n1).toFixed(1)},${base.toFixed(1)} L${xAt(0).toFixed(1)},${base.toFixed(1)} Z" fill="url(#${id}g${si})"/>`;
    }
    body += `<path class="${s.dash ? "" : "draw"}" pathLength="1" d="${pts}" fill="none" stroke="${s.color}" stroke-width="2.8" stroke-linejoin="round" stroke-linecap="round" ${s.dash ? 'stroke-dasharray="6 6" opacity=".8"' : `style="filter:drop-shadow(0 0 6px ${s.color})"`}/>`;
    if (s.dots) s.values.forEach((v, i) => { body += `<circle class="pop" style="animation-delay:${(0.25 + i * 0.09).toFixed(2)}s" cx="${xAt(i).toFixed(1)}" cy="${f.y(v).toFixed(1)}" r="4.2" fill="${s.color}" stroke="${BG}" stroke-width="1.5"/>`; });
    if (!s.dash) {
      const k = s.values.length - 1, ex = xAt(k), ey = f.y(s.values[k]), v = s.values[k];
      body += `<circle class="ping" cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="5" fill="${s.color}"/><circle class="pop" style="animation-delay:1.3s" cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="5.5" fill="${s.color}" stroke="${BG}" stroke-width="2"/>`;
      let ly = ey + 4; usedY.forEach(u => { if (Math.abs(ly - u) < 16) ly = u + (ly >= u ? 16 : -16); }); usedY.push(ly);
      body += `<text class="endlab fade" x="${(ex + 11).toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="start" style="fill:${s.color}">${fmtEnd(v, s)}</text>`;
    }
  });
  const legend = series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("");
  return `<div class="legend">${legend}</div><svg class="chart" data-cid="${id}" viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(label)}"><defs>${defs}</defs>${f.g}${body}${overlay(id, W, h)}</svg>`;
}
/* -------------------------------------------------------------- bayes */
function bayes(p, dir) {      // same rule as engine.update_belief; used only for the home-page demo
  const a = dir > 0 ? 1 + CFG.alpha : 1 - CFG.alpha, b = dir > 0 ? 1 - CFG.alpha : 1 + CFG.alpha;
  return p * a / (p * a + (1 - p) * b);
}

/* ---------------------------------------------------------------- pieces */
const nav = () => `<header class="nav"><a class="brand" data-act="home" title="Home"><span class="mark"><i>M</i><i>M</i></span><span class="wordmark">The Market Maker's Dilemma</span></a>
  <nav><a data-act="how">How it works</a><a href="${GITHUB}" target="_blank" rel="noopener">GitHub</a><button class="mode snd" data-act="sound" aria-pressed="${SFX.on}" aria-label="Sound effects" title="Sound on or off"><svg class="spk-on" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg><svg class="spk-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9l5 6M22 9l-5 6"/></svg></button><button class="mode" data-act="mode" aria-label="Switch between day and night mode" title="Day or night"><svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></svg></button></nav></header>`;
const footer = () => `<div class="foot">An independent project by Andie Burrow, BSc Economics, University of Birmingham. An educational model, not trading advice. Prices are in points. The rules are written in SPEC.md, and the source and tests are on <a href="${GITHUB}" target="_blank" rel="noopener">GitHub</a>.</div>`;
const countSpan = (key, v, dp = 2, signed = true, cls = "") => `<span data-count="${v}" data-key="${key}" data-dp="${dp}" data-signed="${signed ? 1 : 0}" class="${cls}">${signed ? sgn(v, dp) : num(v, dp)}</span>`;

/* ------------------------------------------------------------------ home */
const STORY_DIRS = [1, 1, -1, -1, -1, -1];
function storySteps() {
  let p = 0.5; const steps = [{ p, dir: 0 }];
  STORY_DIRS.forEach(d => { p = bayes(p, d); steps.push({ p, dir: d }); });
  return steps;
}
function storyMeta(steps, i) {
  const s = steps[i], pc = Math.round(s.p * 100), pv = i ? Math.round(steps[i - 1].p * 100) : null;
  const tag = i === 0 ? `<span class="pill">START</span>` : s.dir > 0 ? `<span class="pill buy">BUY</span>` : `<span class="pill sell">SELL</span>`;
  return `<div class="smeta">${tag}<span class="sbel">${i ? `belief <b>${pv}%</b> <i>&rarr;</i> <b>${pc}%</b>` : `belief <b>${pc}%</b>`}</span>${i ? `<span class="sn">trade ${i} of ${steps.length - 1}</span>` : ""}</div>`;
}
function storyText(steps, i) {
  const s = steps[i], pc = Math.round(s.p * 100), b = (100 * bayes(s.p, -1)).toFixed(2), a = (100 * bayes(s.p, 1)).toFixed(2);
  if (i === 0) return ["Start at 50/50", `Before any trade you think the asset is equally likely to be worth <b>0</b> or <b>100</b>. The break-even prices sit at <b>${b}</b> and <b>${a}</b>.`];
  if (i === 1) return ["A trader buys", `Informed traders buy when the asset is worth 100, so a buy is a hint. Your belief rises from <b>50%</b> to <b>${pc}%</b>.`];
  if (i === 2) return ["Another buy", `Two buys in a row lift your belief to <b>${pc}%</b>, and the break-even ask to <b>${a}</b>. Selling at 70 would now be below break-even.`];
  if (i === 3) return ["A trader sells", `A seller pulls your belief back to <b>${pc}%</b>. Buys and sells pull in opposite directions.`];
  if (i < 6) return ["The sells keep coming", `Belief is now <b>${pc}%</b>. The market is telling you something, and your quotes should follow it.`];
  return ["Quote with the evidence", `After four sells in a row your belief is <b>${pc}%</b>. The break-even bid is <b>${b}</b>, so paying more than that to buy loses money on average.`];
}
function home() {
  const steps = storySteps();
  return `${nav()}
  <section class="hero2">
    <div class="hero-top">
      <h1>Quote a price. Then find out who you traded with.</h1>
      <div><p class="lead">Post a bid and an ask against a rival while some traders secretly know where the asset is headed. Every trade tells you something. The coach shows what, using Bayes' rule, and scores your quotes by edge instead of luck.</p>
        <div class="cta"><button class="btn primary" data-act="start-challenge">Start Challenge</button><button class="btn" data-act="start-practice">Practice Mode</button><a class="btn link" data-act="how">How it works</a></div></div>
    </div>
    <div class="intro"><div class="intro-h">New to trading? Here is what you are looking at.</div><div class="intro-g">
      <div><span class="n">1</span><h4>You are the market maker</h4><p>You post two prices at once: a <b>bid</b> (what you will pay) and an <b>ask</b> (what you will sell for). Your profit is the gap between them.</p></div>
      <div><span class="n">2</span><h4>Some traders know more than you</h4><p>About ${pct(CFG.alpha)} of traders secretly know the true value. When one trades with you, you lose. This is called <b>adverse selection</b>.</p></div>
      <div><span class="n">3</span><h4>Try it below</h4><p>Move your mouse over the chart to set your quotes, or send a buyer or seller. The white line is the fair value, and it moves after every trade.</p></div>
    </div></div>
    <div class="board market">
      <div class="mk-top">
        <div><h3>Live market</h3><div class="mk-sub">A demo. Nothing here is scored.</div></div>
        <div class="mk-flaps"><div><div class="lab">Rival bid</div><span id="m-bid"></span></div><div><div class="lab">Rival ask</div><span id="m-ask"></span></div></div>
        <div class="mk-edge"><div class="lab">Your edge</div><b id="m-edge">+0.00</b></div>
      </div>
      <div class="mk-wrap"><canvas id="mkt" aria-label="A live chart of traders arriving. Move your pointer over it to set your own quotes."></canvas>
        <div class="mk-hint" id="m-hint">Move over the chart to quote. Beat the rival's price and you win the trade.</div><div class="mk-banner" id="m-banner"></div></div>
      <div class="mk-ctl">
        <div class="mk-legend"><span><i style="background:var(--paper)"></i>Fair value</span><span><i style="background:var(--dim);opacity:.6"></i>Rival's quotes</span><span><i style="background:var(--buy-hi)"></i>Your bid</span><span><i style="background:var(--sell-hi)"></i>Your ask</span></div>
        <div class="mk-btns"><span class="mk-lab">Your half-spread <b id="m-half">3</b></span><button class="dbtn r" data-mk="half:-1" aria-label="Tighter">${MINUS}</button><button class="dbtn r" data-mk="half:1" aria-label="Wider">+</button>
          <button class="dbtn b" data-mk="buy">Send a buyer</button><button class="dbtn s" data-mk="sell">Send a seller</button></div>
      </div>
    </div>
    <div class="facts"><div><b>${CFG.rounds}</b><span>rounds per session</span></div><div><b>${CFG.n_arrivals}</b><span>traders per round</span></div><div><b>${pct(CFG.alpha)}</b><span>of traders informed</span></div><div><b>0 or 100</b><span>what the asset is worth</span></div></div>
  </section>
  <section class="story">
    <div class="story-grid" style="--n:${steps.length}"><div class="story-stage">
      <div class="story-head"><h2>How one trade moves the price</h2><p class="story-sub">Scroll to step through six trades <span class="bounce" aria-hidden="true">&darr;</span></p></div>
      <div class="story-cols">
      <div class="story-steps"><div class="story-win">${steps.map((st, i) => { const [t, p] = storyText(steps, i);
        return `<div class="step" data-i="${i}"><h3>${t}</h3><p>${p}</p></div>`; }).join("")}</div><div class="sprog">${steps.map(() => "<i></i>").join("")}</div></div>
      <div class="story-vis"><div class="board"><div class="flaps two"><div class="side bid"><div class="lab">Break-even bid</div><span id="s-bid"></span></div><div class="side ask"><div class="lab">Break-even ask</div><span id="s-ask"></span></div></div>
        <div id="story-chart"></div><div class="sbar" aria-hidden="true"><span class="tag start" id="sb-tag">START</span><div class="sbar-track"><i id="sb-dot"></i></div><b id="sb-val">50%</b></div><div class="sbar-ends"><span>asset worth 0</span><span>asset worth 100</span></div><p class="small" style="color:var(--dim)">Same rule as the game, with ${pct(CFG.alpha)} informed traders. The grey band is the range between break-even bid and ask.</p></div></div>
      </div>
    </div></div>
  </section>
  <section class="rows">
    <div><h4>Adverse selection</h4><p>Some traders know more than you. A buy is a hint that the asset is worth more, and your quotes have to allow for that.</p></div>
    <div><h4>Break-even quotes</h4><p>After each trade the coach updates your belief and shows the price where you would neither win nor lose on average.</p></div>
    <div><h4>Skill versus luck</h4><p>Ten trades is a small sample. Expected edge measures your quotes, and realised profit adds the luck. You see both.</p></div>
  </section>${footer()}`;
}
let MARKET = null, STORY = null;
function tweenNum(el, to) {
  const from = el._v ?? 0; el._v = to;
  if (REDUCED) { el.textContent = sgn(to); el.className = tone(to); return; }
  const t0 = performance.now();
  const step = t => { const k = Math.min(1, (t - t0) / 600), v = from + (to - from) * (1 - Math.pow(1 - k, 3)); el.textContent = sgn(v); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step); el.className = tone(to);
}
function mountHome() {
  const mb = new Flap(3, { fs: 46, tone: "buy" }), ma = new Flap(3, { fs: 46, tone: "sell" });
  $("#m-bid").replaceWith(mb.el); $("#m-ask").replaceWith(ma.el);
  const edgeEl = $("#m-edge"), banner = $("#m-banner"), hint = $("#m-hint");
  MARKET = new Market($("#mkt"), {
    alpha: CFG.alpha,
    onQuotes: q => { mb.set(String(q.rb)); ma.set(String(q.ra)); },
    onEdge: v => tweenNum(edgeEl, v),
    onFill: f => SFX.fill(f.filler === "rival" ? "rival" : f.edge >= 0 ? "good" : "bad"),
    onEngage: () => hint.classList.add("gone"),
    onReveal: r => { banner.textContent = `True value ${r.value}. ${r.informed} of ${r.n} traders were informed (the ringed dots).`; banner.classList.add("show"); SFX.reveal(); },
    onNext: () => banner.classList.remove("show"),
  });
  mb.set("40", { spin: 6, stagger: 90 }); ma.set("60", { spin: 6, stagger: 90 });
  // scroll story: the chart glides with the scroll, it never resets
  const steps = storySteps(), sb = new Flap(5, { fs: 40, tone: "buy" }), sa = new Flap(5, { fs: 40, tone: "sell" });
  $("#s-bid").replaceWith(sb.el); $("#s-ask").replaceWith(sa.el);
  const draw = buildStory(steps);
  let shown = -1, cur = 0, tgt = 0, raf = 0;
  const els = [...document.querySelectorAll(".step")], n = steps.length;
  const grid = document.querySelector(".story-grid"), stage = document.querySelector(".story-stage"), dotsEl = [...document.querySelectorAll(".sprog i")];
  const target = () => {
    const r = grid.getBoundingClientRect(), top = window.innerWidth <= 1000 ? 64 : 76;
    document.documentElement.style.setProperty("--visH", document.querySelector(".story-vis").offsetHeight + "px");
    const span = Math.max(1, r.height - stage.offsetHeight), p = Math.max(0, Math.min(1, (top - r.top) / span));
    const s = p * (n - 1), k = Math.min(n - 2, Math.floor(s)), f = s - k, g = Math.max(0, Math.min(1, (f - 0.18) / 0.64));
    return p >= 1 ? n - 1 : k + g * g * (3 - 2 * g);   // hold on each step, glide between them
  };
  const win = document.querySelector(".story-win"), sbDot = $("#sb-dot"), sbVal = $("#sb-val"), sbTag = $("#sb-tag");
  const layout = c => {
    const H = win.clientWidth ? win.clientHeight : 400, hs = els.map(e => e.offsetHeight), pitch = Math.max(...hs) + 22;
    els.forEach((el, k) => {
      const d = k - c, ad = Math.min(1, Math.abs(d));
      el.style.transform = `translateY(${(H * 0.30 - hs[k] / 2 + d * pitch).toFixed(1)}px) translateX(${(-16 * ad).toFixed(1)}px) scale(${(1 - 0.07 * ad).toFixed(3)})`;
      el.style.opacity = (1 - 0.66 * ad).toFixed(3); el.style.filter = ad > 0.02 ? `blur(${(ad * 1.6).toFixed(2)}px)` : "none";
    });
  };
  const frame = () => {
    raf = 0; tgt = target(); cur += (tgt - cur) * (REDUCED ? 1 : 0.24);
    if (Math.abs(tgt - cur) < 0.002) cur = tgt;
    draw(cur);
    layout(cur);
    { const k = Math.min(n - 2, Math.floor(cur)), f = cur - k, pv = (steps[k].p + (steps[k + 1].p - steps[k].p) * f) * 100, near = steps[Math.round(cur)];
      sbDot.style.left = pv.toFixed(2) + "%"; sbVal.textContent = Math.round(pv) + "%";
      const tg = near.dir > 0 ? "BUY" : near.dir < 0 ? "SELL" : "START"; if (sbTag.textContent !== tg) { sbTag.textContent = tg; sbTag.className = "tag " + (near.dir > 0 ? "buy" : near.dir < 0 ? "sell" : "start"); } }
    const i = Math.round(cur);
    if (i !== shown) {
      shown = i;
      sb.set((100 * bayes(steps[i].p, -1)).toFixed(2)); sa.set((100 * bayes(steps[i].p, 1)).toFixed(2));
      els.forEach(el => el.classList.toggle("on", +el.dataset.i === i)); dotsEl.forEach((d, k) => d.classList.toggle("done", k <= i));
    }
    if (cur !== tgt) raf = requestAnimationFrame(frame);
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
  window.addEventListener("scroll", kick, { passive: true }); window.addEventListener("resize", kick);
  STORY = { disconnect() { window.removeEventListener("scroll", kick); window.removeEventListener("resize", kick); cancelAnimationFrame(raf); } };
  kick();
}
function buildStory(steps) {
  const W = 560, H = 215, m = { l: 36, r: 16, t: 22, b: 26 }, n = steps.length;
  const x = k => m.l + k * (W - m.l - m.r) / (n - 1), y = v => m.t + (100 - v) * (H - m.t - m.b) / 100;
  let s = `<svg class="schart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Belief after each trade, moving as you scroll">`;
  [0, 25, 50, 75, 100].forEach(v => { s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--rule)" stroke-dasharray="${v === 50 ? "" : "2 5"}"/><text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`; });
  steps.forEach((st, k) => { s += `<text x="${x(k)}" y="${H - 6}" text-anchor="middle">${k === 0 ? "start" : st.dir > 0 ? "buy" : "sell"}</text>`; });
  s += `<path id="sc-band" fill="var(--dim)" opacity=".16"/><path id="sc-line" fill="none" stroke="var(--paper)" stroke-width="2.6" stroke-linejoin="round" style="filter:drop-shadow(0 0 6px var(--amber-hi))"/><g id="sc-dots"></g><circle id="sc-head" r="6.5" fill="var(--amber-hi)"/><text id="sc-lab" text-anchor="middle" style="fill:var(--amber-hi);font-weight:600"></text></svg>`;
  $("#story-chart").innerHTML = s;
  const line = $("#sc-line"), band = $("#sc-band"), dots = $("#sc-dots"), head = $("#sc-head"), lab = $("#sc-lab");
  const P = k => steps[k].p * 100, A = k => 100 * bayes(steps[k].p, 1), B = k => 100 * bayes(steps[k].p, -1);
  const at = (f, t) => { const k = Math.min(n - 2, Math.floor(t)), fr = t - k; return f(k) + (f(k + 1) - f(k)) * fr; };
  return t => {
    t = Math.max(0, Math.min(n - 1, t));
    const k = Math.floor(t), xs = [], ts = [];
    for (let i = 0; i <= k; i++) ts.push(i);
    if (t - k > 1e-6) ts.push(t);
    let d = "", up = "", dn = "";
    ts.forEach((tt, j) => {
      const xx = x(tt), vp = Number.isInteger(tt) ? P(tt) : at(P, tt), va = Number.isInteger(tt) ? A(tt) : at(A, tt), vb = Number.isInteger(tt) ? B(tt) : at(B, tt);
      d += `${j ? "L" : "M"}${xx.toFixed(1)},${y(vp).toFixed(1)} `; up += `${j ? "L" : "M"}${xx.toFixed(1)},${y(va).toFixed(1)} `; dn = `L${xx.toFixed(1)},${y(vb).toFixed(1)} ` + dn;
    });
    line.setAttribute("d", d); band.setAttribute("d", up + dn + "Z");
    let dd = ""; for (let i = 0; i <= k; i++) dd += `<circle cx="${x(i)}" cy="${y(P(i))}" r="3.6" fill="var(--paper)"/>`;
    dots.innerHTML = dd;
    const hv = Number.isInteger(t) ? P(t) : at(P, t);
    head.setAttribute("cx", x(t)); head.setAttribute("cy", y(hv));
    lab.setAttribute("x", x(t)); lab.setAttribute("y", y(hv) - 14); lab.textContent = Math.round(hv) + "%";
  };
}

/* ------------------------------------------------------------------- how */
function how() {
  const a = CFG.alpha;
  return `${nav()}<div class="how">
  <h2>How it works</h2>
  <div class="sec"><h3>The market</h3><p>An asset is secretly worth <b>0 or 100</b>, equally likely. Traders arrive one at a time. With probability <b>${pct(a)}</b> a trader is informed and always trades the right way: they buy if it is worth 100 and sell if it is worth 0. Otherwise they flip a coin. This is the Glosten-Milgrom adverse-selection model.</p></div>
  <div class="sec"><h3>What a trade tells you</h3><p>After each trade the coach updates the probability <i>p</i> that the asset is worth 100 with Bayes' rule. After a buy:</p>
    <span class="eq">p' = p (1 + ${a}) / [ p (1 + ${a}) + (1 &minus; p)(1 &minus; ${a}) ]</span>
    <p>After a sell the two factors swap. The <b>reference</b> ask is 100 times the belief after a buy, and the reference bid is 100 times the belief after a sell. They are break-even prices under the model, not the best prices to quote. At the start the reference is bid 40, ask 60.</p></div>
  <div class="sec"><h3>The rival</h3><p>A computer rival quotes the reference pushed outward by ${CFG.delta} points, rounded outward to whole ticks. Each trader deals with the better price and <b>ties go to the rival</b>. The rival is a fixed rule, not a strategic opponent.</p></div>
  <div class="sec"><h3>Scoring</h3><p><b>Expected edge</b> is how far your price was from break-even, summed over your fills. It measures the quality of your quotes using only what you could know. <b>Realised profit</b> adds luck, because ten trades is a small sample. Over many rounds the two have the same average, which the project checks exactly. Judge yourself by edge.</p></div>
  <div class="sec"><h3>Challenge and Practice</h3><p>In Challenge the break-even prices stay hidden until you lock your quotes. In Practice they are shown first.</p></div>
  <div class="sec"><h3>Hidden until the round ends</h3><p>The true value, which traders were informed, future arrivals and the rival's unexecuted quotes. The public tape shows each trade's direction, fill price and who filled it. The server never sends the hidden information before settlement.</p></div>
  <div class="sec"><h3>Limits</h3><p>Informed traders ignore price. The rival never adapts. Break-even is a benchmark, not an optimum. With ten trades per round, realised profit is mostly luck.</p></div>
  <div class="sec"><h3>About the project</h3><p>A student project by Andie Burrow (BSc Economics, University of Birmingham) on adverse selection in market making. The maths is the Glosten-Milgrom model. The rules are written in SPEC.md, and every number in the game comes from tested Python code.</p></div>
  <div class="actions"><button class="btn primary" data-act="start-challenge">Start Challenge</button><a class="btn" href="${GITHUB}" target="_blank" rel="noopener">View source and tests</a></div>
  </div>${footer()}`;
}

/* ------------------------------------------------------------------ play */
function boardBody(d) {
  if (d.finished) {
    return d.review
      ? `<p>All ${d.n_arrivals} traders served. The true value is revealed below.</p><button class="lock" data-act="toreview">See the full review</button>`
      : `<p>All ${d.n_arrivals} traders served. Reveal the true value to score the round.</p>
         <div class="err">${esc(err)}</div><button class="lock" data-act="settle">Reveal true value</button>`;
  }
  const nudge = side => `<div class="nudge"><button type="button" data-step="${side}:-1" aria-label="Lower ${side} by 1">${MINUS}</button><button type="button" data-step="${side}:1" aria-label="Raise ${side} by 1">+</button></div>`;
  return `<div class="flaps">
      <div class="side bid"><div class="lab">Your bid<small>you buy at</small></div><span id="ph-bid"></span>${nudge("bid")}</div>
      <div class="mid"><div class="lab">Spread</div><span id="ph-spread"></span></div>
      <div class="side ask"><div class="lab">Your ask<small>you sell at</small></div><span id="ph-ask"></span>${nudge("ask")}</div>
    </div>`;
}
function board(d) {
  const ref = d.reference
    ? `<span class="refline">Break-even now: bid ${num(d.reference.bid)}, ask ${num(d.reference.ask)}</span>`
    : `<span class="refline off">Break-even prices are hidden until you lock</span>`;
  const head = d.finished ? "Round complete" : `Trader ${d.arrival} of ${d.n_arrivals}`;
  return `<section class="board"><div class="board-top"><h2>${head}</h2>${d.finished ? "" : ref}</div>
    ${boardBody(d)}<span id="ph-arena"></span>
    ${d.finished ? "" : `<div class="err" id="err">${esc(err)}</div><button class="lock" data-act="lock">Lock quotes<kbd>Enter</kbd></button>`}</section>`;
}

function coach(l) {
  if (!l) return `<section class="coach"><h3>Bayesian coach</h3><p class="empty">Lock a quote and the coach explains the trade here: what it told you, and what a break-even price would have been.</p></section>`;
  const mine = l.filler === "you", side = l.direction === "BUY" ? "ask" : "bid", ref = l.direction === "BUY" ? l.ref_ask : l.ref_bid;
  return `<section class="coach"><h3>Bayesian coach, trader ${l.t}</h3>
    <div class="line">The trader wanted to ${pill(l.direction)}. You quoted <span class="mono"><b>${px(l.my_bid)}</b> / <b>${px(l.my_ask)}</b></span>. ${who(l.filler)} filled it.</div>
    <div class="tiles">
      <div><div class="tile-l">Break-even ${side}</div><div class="tile-v">${num(ref)}</div></div>
      <div><div class="tile-l">${mine ? "Your price" : "Rival price"}</div><div class="tile-v">${px(l.price)}</div></div>
      <div><div class="tile-l">Expected edge</div><div class="tile-v ${mine ? tone(l.edge) : ""}">${mine ? sgn(l.edge) : "none"}</div></div>
    </div><div class="coachnote">${esc(l.note)}</div></section>`;
}
function position(d) {
  return `<section class="side-sec"><h3>Your position</h3>
    <div class="rowline"><span>Cash</span><span class="v ${tone(d.cash)}">${sgn(d.cash, 0)}</span></div>
    <div class="rowline"><span>Inventory</span><span class="v">${d.inventory > 0 ? "+" : d.inventory < 0 ? MINUS : ""}${Math.abs(d.inventory)}</span></div>
    <p class="small" style="margin:10px 0 0">A plus means you hold units. A minus means you sold units you do not hold. Everything closes out at the true value when the round ends.</p></section>`;
}
function tapePanel(d) {
  const fresh = D.sid + ":" + D.round + ":" + d.tape.length;
  const isNew = tapeKey !== null && tapeKey !== fresh;
  tapeKey = fresh;
  const rows = d.tape.slice().reverse().map((r, i) => `<tr class="${isNew && i === 0 ? "new" : ""}"><td>${r.t}</td><td>${pill(r.direction)}</td><td>${px(r.price)}</td><td>${who(r.filler)}</td></tr>`).join("");
  const body = d.tape.length ? `<table class="tape"><thead><tr><th>#</th><th>Trader</th><th>Price</th><th>Filled by</th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="empty">No trades yet.</p>`;
  return `<section class="side-sec"><h3>Public market tape</h3>${body}
    <p class="small" style="margin:10px 0 0">Every trade, including the rival's. It never shows the true value, trader types or future arrivals.</p></section>`;
}

/* review */
function railSVG(v, k) {
  const X0 = 40, X1 = 960, RY = 104, x = p => X0 + (X1 - X0) * p / 100;
  let s = `<svg class="rsvg" viewBox="0 0 1000 176" role="img" aria-label="Replay of the round on the price rail">`;
  for (let p = 0; p <= 100; p += 10) s += `<line x1="${x(p)}" x2="${x(p)}" y1="${RY}" y2="${RY + 8}" stroke="${AXIS}"/><text x="${x(p)}" y="${RY + 28}" text-anchor="middle">${p}</text>`;
  s += `<line x1="${X0}" x2="${X1}" y1="${RY}" y2="${RY}" stroke="${INK}" stroke-width="2"/>`;
  const tv = x(v.value), tvc = v.value === 100 ? GREEN : RED;
  s += `<line x1="${tv}" x2="${tv}" y1="30" y2="${RY}" stroke="${tvc}" stroke-width="2" stroke-dasharray="5 5"/><text x="${v.value === 100 ? tv - 8 : tv + 8}" y="40" text-anchor="${v.value === 100 ? "end" : "start"}" style="fill:${tvc};font-weight:700">true value ${v.value}</text>`;
  const stack = {};
  v.rows.slice(0, k).forEach(r => {
    const key = Math.round(r.price * 2), n = stack[key] = (stack[key] || 0) + 1, cy = RY - 10 - (n - 1) * 13, cx = x(r.price);
    const c = r.direction === "BUY" ? GREEN : RED, mine = r.filler === "you";
    if (r.type === "informed") s += `<circle cx="${cx}" cy="${cy}" r="9" fill="none" stroke="${AMBER}" stroke-width="3"/>`;
    s += `<circle cx="${cx}" cy="${cy}" r="5.5" fill="${mine ? c : "none"}" stroke="${mine ? c : AXIS}" stroke-width="2"/>`;
  });
  if (k > 0) {
    const r = v.rows[k - 1];
    [["my_bid", GREEN, 60], ["my_ask", RED, 60]].forEach(([f, c, y]) => { s += `<line x1="${x(r[f])}" x2="${x(r[f])}" y1="${y}" y2="${RY}" stroke="${c}" stroke-width="3"/>`; });
    [r.rival_bid, r.rival_ask].forEach(p => { s += `<line x1="${x(p)}" x2="${x(p)}" y1="${RY - 24}" y2="${RY}" stroke="${AXIS}" stroke-width="2" stroke-dasharray="3 3"/>`; });
  }
  const b = v.beliefs[k];
  s += `<g style="transition:transform .5s"><circle cx="${x(b)}" cy="${RY}" r="8" fill="${AMBER}" stroke="${BG}" stroke-width="2"/><text x="${x(b)}" y="${RY + 52}" text-anchor="middle" style="fill:${AMBER};font-weight:700">belief ${b.toFixed(0)}%</text></g>`;
  return s + "</svg>";
}
function describe(v, k) {
  if (k === 0) return "Before any trader arrived, you believed the asset was equally likely to be worth 0 or 100. Drag the slider or press Play.";
  const r = v.rows[k - 1], e = v.per_edge[k - 1];
  const tail = r.filler === "you" ? ` You filled it at ${px(r.price)}, an expected edge of ${sgn(e)}.` : ` The rival filled it at ${px(r.price)}.`;
  return `Trader ${k} was ${r.type === "informed" ? "informed" : "uninformed"} and wanted to ${r.direction === "BUY" ? "buy" : "sell"}. You quoted ${px(r.my_bid)} / ${px(r.my_ask)}, the rival ${px(r.rival_bid)} / ${px(r.rival_ask)}.${tail}`;
}
function replayHTML(v) {
  const n = v.rows.length;
  return `<div class="sect"><h3>Replay the round</h3><div class="replay"><div class="ctl"><button class="btn sm" data-act="replay">Play</button>
    <input type="range" id="rk" min="0" max="${n}" value="${REPLAY.k}" aria-label="Arrival to show"><b id="rklab">${REPLAY.k} of ${n}</b></div>
    <div id="rbody">${railSVG(v, REPLAY.k)}</div><p class="desc small" id="rdesc">${esc(describe(v, REPLAY.k))}</p>
    <p class="small" style="margin:6px 0 0">Ringed dots mark informed traders. Filled dots are your fills, hollow dots are the rival's.</p></div></div>`;
}
function setReplay(k) {
  REPLAY.k = k; const v = D.review; if (!v) return;
  $("#rbody").innerHTML = railSVG(v, k); $("#rdesc").textContent = describe(v, k);
  $("#rk").value = k; $("#rklab").textContent = `${k} of ${v.rows.length}`;
}
function stopReplay() { if (REPLAY.timer) { clearInterval(REPLAY.timer); REPLAY.timer = null; } }
function playReplay() {
  stopReplay(); const n = D.review.rows.length; setReplay(0);
  REPLAY.timer = setInterval(() => { if (REPLAY.k >= n) return stopReplay(); setReplay(REPLAY.k + 1); }, 900);
}

function plainSummary(v) {
  const rows = v.rows, N = rows.length, mine = rows.filter(r => r.filler === "you"), nf = mine.length, inf = mine.filter(r => r.type === "informed").length;
  const e = v.edge, pnl = v.pnl, P = x => `${Math.abs(x).toFixed(2)} points ${x >= 0 ? "up" : "down"}`, S = x => sgn(x, 2);
  let tone_, head, happened, luck, next;
  if (nf === 0) {
    tone_ = "flat"; head = "Nobody traded with you this round";
    happened = `The rival had a better price every time, so it took all ${N} trades. The true value turned out to be ${v.value}.`;
    luck = "With no trades there is no profit and no loss, so there is no luck to talk about either.";
    next = "Your bid and ask were too far apart. Bring them closer to the middle so you win some trades, but not past the break-even prices the coach shows.";
  } else {
    tone_ = e > 2 ? "good" : e < -2 ? "bad" : "flat";
    head = e > 2 ? "A good round: your prices were better than fair" : e < -2 ? "You gave a little value away this round" : "About fair: your prices were close to break-even";
    happened = `${nf} of the ${N} traders dealt with you and the rival won the other ${N - nf}. The true value turned out to be ${v.value}.` +
      (inf ? ` ${inf} of your trades were with someone who secretly knew the answer, and those are the ones that hurt.` : " None of your trades were with someone who knew the answer, so you got the easy ones.");
    if (pnl >= 0 && e < 0) luck = `You ended ${P(pnl)}, but your quotes scored ${S(e)}. That profit came from luck, not from good pricing. Ten trades is a tiny sample, so luck can easily look like skill.`;
    else if (pnl < 0 && e >= 0) luck = `You ended ${P(pnl)}, but your quotes scored ${S(e)}. Your pricing was fine and you were unlucky. Over many rounds luck averages out and the pricing is what is left.`;
    else if (pnl >= 0) luck = `You ended ${P(pnl)}, and your quotes scored ${S(e)}. Profit and quality agree here, which is the result you want.`;
    else luck = `You ended ${P(pnl)}, and your quotes scored ${S(e)}. Both are negative, so this round was a mix of poor pricing and bad luck.`;
    next = e < -2
      ? "Compare your bid and ask with the coach's break-even prices. If you sell below break-even or buy above it, you lose on average, even on a lucky day. Move your ask up and your bid down toward the coach's numbers."
      : "Keep your quotes near the coach's break-even prices. If you want more trades, tighten the gap a little, but never go past break-even.";
  }
  const blk = (l, t) => `<div class="pl-b"><div class="pl-l">${l}</div><p>${t}</p></div>`;
  return `<section class="plain ${tone_}"><div class="pl-k">In plain English</div><h3>${head}</h3>
    <div class="pl-g">${blk("What happened", happened)}${blk("Skill or luck?", luck)}${blk("What to try next", next)}</div>
    <details class="gloss"><summary>Words used on this page</summary><dl>
      <dt>Bid and ask</dt><dd>The price you will pay to buy, and the price you will accept to sell. You earn the gap between them.</dd>
      <dt>Break-even price</dt><dd>The price where, on average, you neither win nor lose, given what the trades so far suggest.</dd>
      <dt>Expected edge</dt><dd>How much better or worse your prices were than break-even, added up over your trades. It is the model's measure of your pricing, so it only counts trades that actually happened.</dd>
      <dt>Luck</dt><dd>The difference between what you actually made and your edge. Over only ten trades it is usually the bigger number.</dd>
      <dt>Informed trader</dt><dd>Someone who secretly knows the true value. They only trade when it helps them, so trading with them loses you money. This is adverse selection.</dd>
    </dl></details></section>`;
}
function review(d) {
  const v = d.review, labels = v.rows.map(r => String(r.t)), key = `${d.sid}:${d.round}`;
  if (REPLAY.key !== key) { REPLAY.key = key; REPLAY.k = v.rows.length; }
  const rows = v.rows.map(r => `<tr><td>${r.t}</td><td>${pill(r.direction)}</td><td>${r.type === "informed" ? "<b>informed</b>" : "uninformed"}</td><td>${who(r.filler)}</td><td>${px(r.price)}</td>
    <td>${px(r.my_bid)}</td><td>${px(r.my_ask)}</td><td>${px(r.rival_bid)}</td><td>${px(r.rival_ask)}</td><td>${num(r.ref_bid)}</td><td>${num(r.ref_ask)}</td></tr>`).join("");
  const kp = (l, k, val, big) => `<div class="kpi"><div class="kpi-l">${l}</div><div class="kpi-v ${tone(val)}">${countSpan(`rev:${key}:${k}`, val, 2, true)}</div></div>`;
  return `<section class="review"><h2>Round review</h2>
  <div class="board"><div class="revealband">
    <div><div class="vlabel">True value revealed</div><span id="ph-reveal"></span></div>
    <div class="kpis">${kp("Expected edge (the headline)", "edge", v.edge)}${kp("Realised profit", "pnl", v.pnl)}${kp("Luck (profit minus edge)", "luck", v.luck)}</div>
  </div><div class="note">${esc(v.note)}</div></div>
  ${plainSummary(v)}
  ${replayHTML(v)}
  <div class="charts">
    <div class="chartbox"><h3>Belief history</h3>${lineChart({ series: [
        { name: "Belief that the asset is worth 100 (%)", color: INK, values: v.beliefs, dots: true, pct: true },
        { name: "True value", color: v.value === 100 ? GREEN : RED, values: v.beliefs.map(() => v.value), dash: true }],
        labels: ["0", ...labels], range: fixedRange(0, 100), label: "Belief history over the round", area: true })}
      <p class="small">The horizontal axis counts trades seen so far.</p></div>
    <div class="chartbox"><h3>Edge versus luck, running total</h3>${lineChart({ series: [
        { name: "Expected edge", color: BLUE, values: v.cum_edge }, { name: "Realised profit", color: AMBER, values: v.cum_pnl }],
        labels, label: "Cumulative expected edge and realised profit", area: true, gap: true })}
      <p class="small">The gap between the lines is luck.</p></div>
  </div>
  <details class="more"><summary>Every arrival, now revealed</summary><div class="scroll"><table class="rev"><thead><tr><th>#</th><th>Trader</th><th>Type</th><th>Filled by</th><th>Price</th><th>Your bid</th><th>Your ask</th><th>Rival bid</th><th>Rival ask</th><th>Ref bid</th><th>Ref ask</th></tr></thead><tbody>${rows}</tbody></table></div></details>
  <div class="actions">${d.session.over ? "" : `<button class="btn primary" data-act="next">Next round</button>`}</div></section>`;
}

function sessionPlain(s) {
  const R = s.results, n = R.length, E = s.total_edge, PL = s.total_pnl, nf = R.reduce((t, r) => t + r.fills, 0), pos = R.filter(r => r.edge > 0).length;
  const best = R.reduce((b, r) => (r.edge > b.edge ? r : b), R[0]), worst = R.reduce((b, r) => (r.edge < b.edge ? r : b), R[0]);
  const P = x => `${Math.abs(x).toFixed(2)} points ${x >= 0 ? "up" : "down"}`, S = x => sgn(x, 2), avg = E / n;
  const tone_ = avg > 1 ? "good" : avg < -1 ? "bad" : "flat";
  const head = nf === 0 ? "You barely traded this session" : avg > 1 ? "A strong session: your pricing held up" : avg < -1 ? "Your pricing cost you over the session" : "A roughly break-even session";
  const did = nf === 0
    ? `Across ${n} round${n > 1 ? "s" : ""} the rival won every trade, so there is nothing to score. Narrower quotes would get you into some trades.`
    : `Across ${n} round${n > 1 ? "s" : ""} you made ${nf} trades. Your quotes scored ${S(E)} in total, and were better than fair in ${pos} of ${n}.`;
  let luck;
  if (nf === 0) luck = "With no trades there is no luck to measure.";
  else if (PL >= 0 && E < 0) luck = `You finished ${P(PL)}, but your pricing scored ${S(E)}. Luck carried you. Repeat this with the same quotes and the profit is likely to shrink.`;
  else if (PL < 0 && E >= 0) luck = `You finished ${P(PL)}, but your pricing scored ${S(E)}. That was bad luck, not bad quoting, and more rounds would tend to even it out.`;
  else if (PL >= 0) luck = `You finished ${P(PL)} and your pricing scored ${S(E)}. Profit and quality agree, which is the sign of a repeatable approach.`;
  else luck = `You finished ${P(PL)} and your pricing scored ${S(E)}. The losses came from the pricing itself, so adjusting your quotes is what will help.`;
  const spread = n > 1 && nf > 0 ? `Your best round was round ${best.round} (edge ${S(best.edge)}) and your worst was round ${worst.round} (edge ${S(worst.edge)}). Look at what you quoted in each, because the difference is where you learn the most.` : "Play a few more rounds to see how steady your pricing is.";
  const blk = (l, t) => `<div class="pl-b"><div class="pl-l">${l}</div><p>${t}</p></div>`;
  return `<section class="plain ${tone_}"><div class="pl-k">Your session in plain English</div><h3>${head}</h3>
    <div class="pl-g">${blk("How it went", did)}${blk("Skill or luck?", luck)}${blk("Your best and worst round", spread)}</div></section>`;
}
function sessionPanel(d) {
  const s = d.session;
  const rows = s.results.map(r => `<tr><td>${r.round}</td><td>${r.value}</td><td class="${tone(r.edge)}">${sgn(r.edge)}</td><td class="${tone(r.pnl)}">${sgn(r.pnl)}</td><td class="${tone(r.luck)}">${sgn(r.luck)}</td><td>${r.fills}</td></tr>`).join("");
  return `<section class="sess"><h2>Session so far</h2>
  <div class="board"><div class="kpis sesskpis"><div class="kpi"><div class="kpi-l">Total expected edge (the headline)</div><div class="kpi-v ${tone(s.total_edge)}">${sgn(s.total_edge)}</div></div>
    <div class="kpi"><div class="kpi-l">Total realised profit</div><div class="kpi-v ${tone(s.total_pnl)}">${sgn(s.total_pnl)}</div></div></div>
    ${s.over ? `<div class="note">Session complete. Download the log to keep a record of every round.</div>` : ""}</div>
  ${s.over ? sessionPlain(s) : ""}
  <div class="sect scroll"><table class="rev"><thead><tr><th>Round</th><th>Value</th><th>Edge</th><th>Profit</th><th>Luck</th><th>Fills</th></tr></thead><tbody>${rows}</tbody></table></div>
  <p class="small">The server keeps the game in memory only while it runs. Download the log if you want to keep it.</p>
  <div class="actions"><a class="btn" href="/api/log?sid=${encodeURIComponent(d.sid)}" download>Download session log</a>
  ${s.over ? `<button class="btn primary" data-act="restart">Play again</button><button class="btn link" data-act="home">Home</button>` : ""}</div></section>`;
}

function play() {
  const d = D, practice = d.mode === "practice";
  const badge = practice
    ? `<span class="badge practice">Practice</span><span class="t">Break-even prices are shown before you quote.</span>`
    : `<span class="badge challenge">Challenge</span><span class="t">Break-even prices stay hidden until you lock.</span>`;
  const segs = Array.from({ length: d.n_arrivals }, (_, i) => `<i class="${i < d.served ? "on" : ""}"></i>`).join("");
  return `${nav()}
  <div class="modeline">${badge}<span class="sp"></span><button class="btn sm" data-act="restart">Restart</button></div>
  <div class="status">
    <div><span class="k">Round</span><b>${d.round} of ${d.rounds}</b></div>
    <div class="segs-wrap"><span class="k">Traders served, ${d.served} of ${d.n_arrivals}</span><div class="segs">${segs}</div></div>
    <div><span class="k">Edge this round</span><b class="${tone(d.round_edge)}">${countSpan(`edge:${d.sid}:${d.round}`, d.round_edge, 2, true)}</b></div>
    <div><span class="k">Informed traders</span><b>${pct(d.alpha)}</b></div>
  </div>
  <div class="stage"><div class="col">${board(d)}${coach(d.last)}</div><aside class="col">${position(d)}${tapePanel(d)}</aside></div>
  ${d.review ? review(d) : ""}${d.session.results.length ? sessionPanel(d) : ""}${footer()}`;
}

/* ---------------------------------------------------------------- render */
function ui() {
  if (UI.arena) return UI;
  UI.arena = new Arena((side, v) => { quotes[side] = v; showQuotes(); });
  UI.bid = new Flap(3, { fs: 84, tone: "buy" }); UI.ask = new Flap(3, { fs: 84, tone: "sell" });
  UI.spread = new Flap(3, { fs: 48 }); UI.reveal = new Flap(3, { fs: 120 });
  UI.fresh = true;
  return UI;
}
function showQuotes() {
  UI.bid.set(String(quotes.bid)); UI.ask.set(String(quotes.ask)); UI.spread.set(String(quotes.ask - quotes.bid));
  const e = $("#err"); if (e && err) { err = ""; e.textContent = ""; }
}
function mountPlay() {
  if (D.review) { const len = String(D.review.value).length; if (UI.reveal.width !== len) UI.reveal = new Flap(len, { fs: 120 }); }
  const m = (id, node) => { const ph = $("#" + id); if (ph) ph.replaceWith(node); };
  m("ph-arena", UI.arena.svg); m("ph-bid", UI.bid.el); m("ph-ask", UI.ask.el); m("ph-spread", UI.spread.el); m("ph-reveal", UI.reveal.el);
  UI.arena.sync(D, quotes);
  const first = UI.fresh; UI.fresh = false;
  const opts = first ? { spin: 6, stagger: 80 } : {};
  if (!D.finished) {
    UI.bid.set(String(quotes.bid), opts); UI.ask.set(String(quotes.ask), opts); UI.spread.set(String(quotes.ask - quotes.bid), opts);
  }
  if (D.review) {
    const key = D.sid + ":" + D.round;
    if (revealedKey !== key) { revealedKey = key; SFX.reveal(); UI.reveal.set(String(D.review.value), { spin: 9, stagger: 140, tone: D.review.value === 100 ? "buy" : "sell" }); }
    else UI.reveal.set(String(D.review.value), { tone: D.review.value === 100 ? "buy" : "sell" });
  } else { revealedKey = null; UI.reveal.set(""); }
}
function countUps() {
  document.querySelectorAll("[data-count]").forEach(el => {
    const to = +el.dataset.count, key = el.dataset.key, dp = +el.dataset.dp, signed = el.dataset.signed === "1";
    const from = key in PREV ? PREV[key] : 0; PREV[key] = to;
    const fmt = v => (signed ? sgn(v, dp) : num(v, dp));
    if (REDUCED || from === to) { el.textContent = fmt(to); return; }
    const t0 = performance.now(), dur = 900;
    const step = t => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(from + (to - from) * e); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}
function render() {
  const app = $("#app"); stopReplay();
  if (MARKET) { MARKET.destroy(); MARKET = null; } if (STORY) { STORY.disconnect(); STORY = null; }
  if (view === "how") app.innerHTML = how();
  else if (view === "play" && D) { ui(); app.innerHTML = play(); mountPlay(); }
  else { app.innerHTML = home(); mountHome(); }
  countUps();
}

/* ---------------------------------------------------------------- events */
const ACTIONS = {
  home: () => go("home"), how: () => go("how"),
  "start-challenge": () => startGame("challenge"), "start-practice": () => startGame("practice"),
  sound: () => { SFX.set(!SFX.on); document.querySelectorAll(".snd").forEach(b => b.setAttribute("aria-pressed", String(SFX.on))); }, mode: toggleMode, restart: () => startGame(D.mode), lock: lockQuotes, settle, toreview: toReview, next: nextRound, replay: () => playReplay(),
};
document.addEventListener("click", e => {
  const mk = e.target.closest("[data-mk]");
  if (mk && MARKET) {
    const k = mk.dataset.mk;
    if (k === "buy") MARKET.send(1); else if (k === "sell") MARKET.send(-1);
    else { const h = MARKET.setHalf(MARKET.you.half + (k === "half:1" ? 1 : -1)); $("#m-half").textContent = h; }
    return;
  }
  const step = e.target.closest("[data-step]");
  if (step) { const [side, dir] = step.dataset.step.split(":"); UI.arena.setSide(side, UI.arena[side] + Number(dir) * CFG.tick, true); return; }
  const el = e.target.closest("[data-act]");
  if (el && ACTIONS[el.dataset.act]) { e.preventDefault(); ACTIONS[el.dataset.act](); }
});
document.addEventListener("input", e => { if (e.target.id === "rk") { stopReplay(); setReplay(+e.target.value); } });
document.addEventListener("keydown", e => {
  if (e.key === "Enter" && view === "play" && D && !D.finished && !e.target.closest("button, a, input")) { e.preventDefault(); lockQuotes(); }
});

/* glass sheen follows the pointer */
document.addEventListener("pointermove", e => {
  const el = e.target.closest && e.target.closest(".board, .coach, .replay"); if (!el) return;
  const r = el.getBoundingClientRect(); el.style.setProperty("--mx", (e.clientX - r.left) + "px"); el.style.setProperty("--my", (e.clientY - r.top) + "px");
}, { passive: true });

/* chart hover tooltips */
const tip = document.createElement("div"); tip.id = "tip"; document.body.appendChild(tip);
document.addEventListener("pointermove", e => {
  const svg = e.target.closest && e.target.closest("svg[data-cid]");
  document.querySelectorAll(".xh").forEach(l => { if (!svg || !svg.contains(l)) l.style.opacity = 0; });
  if (!svg) { tip.style.opacity = 0; return; }
  const c = CHARTS[svg.dataset.cid]; if (!c) return;
  const r = svg.getBoundingClientRect(), vx = (e.clientX - r.left) * c.W / r.width;
  let best = 0; c.xs.forEach((x, i) => { if (Math.abs(x - vx) < Math.abs(c.xs[best] - vx)) best = i; });
  const line = svg.querySelector(".xh"); line.setAttribute("x1", c.xs[best]); line.setAttribute("x2", c.xs[best]); line.style.opacity = 0.5;
  tip.innerHTML = `<b>${esc(c.labels[best])}</b>` + c.series.map(s => `<br>${esc(s.name)}: <b>${c.fmt(s.values[best])}</b>`).join("");
  tip.style.left = Math.min(window.innerWidth - 230, e.clientX + 16) + "px"; tip.style.top = (e.clientY + 14) + "px"; tip.style.opacity = 1;
});

/* ------------------------------------------------------- day / night */
function setMode(mode, rerender) {
  document.documentElement.dataset.theme = mode;
  try { localStorage.setItem("mmd-mode", mode); } catch (e) { /* storage may be blocked */ }
  readColors(); window.dispatchEvent(new Event("mmd-theme"));
  if (rerender) { Object.keys(UI).forEach(k => delete UI[k]); render(); }
}
function toggleMode() { if (!busy) setMode(document.documentElement.dataset.theme === "night" ? "day" : "night", true); }
function initialMode() {
  try { const m = localStorage.getItem("mmd-mode"); if (m === "day" || m === "night") return m; } catch (e) { /* ignore */ }
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "night" : "day";
}

(async function init() {
  try { const pal = new URLSearchParams(location.search).get("pal"); if (pal) document.documentElement.dataset.pal = pal; } catch (e) {}   // temporary colour preview: ?pal=rose or ?pal=violet
  setMode(initialMode(), false);
  try { CFG = await call("config"); } catch (e) { /* keep defaults */ }
  render();
})();
