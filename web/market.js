"use strict";
/* The live market on the home page: traders stream in and trade against a rival,
   and against YOU if you put your cursor on the chart. It is a demo, not scored.
   It uses the same Bayes rule and rival rule as the real game (engine.py). */
const mbayes = (p, dir, a) => {
  const up = dir > 0 ? 1 + a : 1 - a, dn = dir > 0 ? 1 - a : 1 + a;
  return p * up / (p * up + (1 - p) * dn);
};
const rivalQuotes = p => {          // reference +/- 2, rounded outward, clipped to 0..100
  const lo = 100 * mbayes(p, -1, MARKET_ALPHA), hi = 100 * mbayes(p, 1, MARKET_ALPHA);
  return { rb: Math.max(0, Math.floor(lo - 2 + 1e-9)), ra: Math.min(100, Math.ceil(hi + 2 - 1e-9)), refB: lo, refA: hi };
};
let MARKET_ALPHA = 0.2;

class Market {
  constructor(canvas, hooks = {}) {
    this.cv = canvas; this.g = canvas.getContext("2d"); this.hooks = hooks;
    MARKET_ALPHA = hooks.alpha ?? 0.2;
    this.N = 12; this.speed = 66;
    this.T = 0; this.last = null; this.alive = true; this.visible = true;
    this.you = { y: null, half: hooks.half ?? 3 };
    this.edge = 0; this.traders = []; this.bursts = []; this.labels = [];
    this.hist = []; this.eps = [];
    this.newEpisode(true);
    this.readColors(); this.resize();
    this.onTheme = () => this.readColors(); window.addEventListener("mmd-theme", this.onTheme);
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(canvas);
    this.io = new IntersectionObserver(es => { this.visible = es[0].isIntersecting; }); this.io.observe(canvas);
    canvas.addEventListener("pointermove", e => this.point(e));
    canvas.addEventListener("pointerdown", e => this.point(e));
    this.frame = this.frame.bind(this);
    if (REDUCED) { for (let i = 0; i < 40; i++) this.step(0.3); this.draw(); }
    else this.raf = requestAnimationFrame(this.frame);
  }
  destroy() { this.alive = false; cancelAnimationFrame(this.raf); this.ro.disconnect(); this.io.disconnect(); window.removeEventListener("mmd-theme", this.onTheme); }
  readColors() {
    const v = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    this.c = { paper: v("--paper"), dim: v("--dim"), buy: v("--buy-hi"), sell: v("--sell-hi"), amber: v("--amber-hi"), rule: v("--rule"), tile: v("--tile") };
  }
  resize() {
    const r = this.cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = Math.max(300, r.width); this.H = Math.max(240, r.height);
    this.cv.width = this.W * dpr; this.cv.height = this.H * dpr; this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.nowX = this.W * (this.W < 640 ? 0.6 : 0.68);
    if (REDUCED) this.draw();
  }
  yOf(price) { return 16 + (100 - price) / 100 * (this.H - 36); }
  priceAt(y) { return Math.round(Math.max(1, Math.min(99, 100 - (y - 16) / (this.H - 36) * 100))); }
  xOf(t) { return this.nowX - (this.T - t) * this.speed; }
  point(e) {
    const r = this.cv.getBoundingClientRect();
    this.you.y = this.priceAt(e.clientY - r.top);
    if (this.hooks.onEngage) this.hooks.onEngage();
  }
  setHalf(h) { this.you.half = Math.max(1, Math.min(15, h)); return this.you.half; }
  youQuotes() {
    if (this.you.y == null) return null;
    const m = this.you.y, h = this.you.half;
    return { bid: Math.max(0, Math.round(m - h)), ask: Math.min(100, Math.round(m + h)) };
  }

  /* ------------------------------------------------------------ episodes */
  newEpisode(first) {
    const value = Math.random() < 0.5 ? 0 : 100;
    const ep = { value, p: 0.5, t0: this.T, spawned: 0, done: 0, state: "run", spawnIn: first ? 0.4 : 1.0, events: [], holdUntil: 0, revealAt: null, informed: 0 };
    this.eps.push(ep); this.ep = ep;
    const q = rivalQuotes(0.5);
    this.hist.push({ t: this.T, p: 0.5, rb: q.rb, ra: q.ra, start: true });
    this.emitQuotes();
  }
  emitQuotes() {
    const q = rivalQuotes(this.ep.p);
    if (this.hooks.onQuotes) this.hooks.onQuotes({ rb: q.rb, ra: q.ra, p: this.ep.p });
  }
  send(dir) {
    const ep = this.ep;
    if (ep.state !== "run" || ep.spawned >= this.N) return false;
    ep.spawned++;
    const informed = dir === undefined ? Math.random() < MARKET_ALPHA : false;
    const d = dir !== undefined ? dir : informed ? (ep.value === 100 ? 1 : -1) : (Math.random() < 0.5 ? 1 : -1);
    this.traders.push({ x: this.W + 20, d, informed, ep, trail: [], age: 0, wob: Math.random() * 6 });
    return true;
  }
  resolve(tr) {
    const ep = tr.ep, p = ep.p, q = rivalQuotes(p), yq = this.youQuotes();
    let price, filler = "rival";
    if (tr.d > 0) { price = q.ra; if (yq && yq.ask < q.ra) { price = yq.ask; filler = "you"; } }
    else { price = q.rb; if (yq && yq.bid > q.rb) { price = yq.bid; filler = "you"; } }
    const edge = filler === "you" ? (tr.d > 0 ? price - q.refA : q.refB - price) : 0;
    ep.p = mbayes(p, tr.d, MARKET_ALPHA);
    const nq = rivalQuotes(ep.p);
    const ev = { t: this.T, d: tr.d, price, filler, informed: tr.informed, edge };
    ep.events.push(ev); ep.done++; if (tr.informed) ep.informed++;
    this.hist.push({ t: this.T, p: ep.p, rb: nq.rb, ra: nq.ra, ev });
    const col = filler === "rival" ? this.c.dim : edge >= 0 ? this.c.buy : this.c.sell;
    const y = this.yOf(price);
    for (let i = 0; i < 16; i++) { const a = Math.random() * 6.283, s = 40 + Math.random() * 120; this.bursts.push({ x: this.nowX, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.7, col }); }
    // short caption for what just happened; rival captions are skipped if another is still on screen, so it never gets crowded
    const crowded = this.labels.some(l => l.life > 0.8 && Math.abs(l.x - this.nowX) < 140);
    if (filler === "you" || !crowded) {
      const text = filler === "rival" ? "Rival filled" : (tr.d > 0 ? "You sold " : "You bought ") + (edge < -0.004 ? "−" : "+") + Math.abs(edge).toFixed(1);
      this.labels.push({ x: this.nowX, y: y - 16, life: filler === "you" ? 1.9 : 1.3, col, text, pill: filler === "you" });
    }
    if (filler === "you") { this.edge += edge; if (this.hooks.onEdge) this.hooks.onEdge(this.edge); }
    if (this.hooks.onFill) this.hooks.onFill({ filler, edge, dir: tr.d, price });
    this.emitQuotes();
  }

  /* ---------------------------------------------------------------- loop */
  frame(ts) {
    if (!this.alive) return;
    if (this.last == null) this.last = ts;
    const dt = Math.min(0.05, (ts - this.last) / 1000); this.last = ts;
    if (this.visible && !document.hidden) { this.step(dt); this.draw(); }
    this.raf = requestAnimationFrame(this.frame);
  }
  step(dt) {
    this.T += dt;
    const ep = this.ep;
    if (ep.state === "run") {
      ep.spawnIn -= dt;
      if (ep.spawned < this.N && ep.spawnIn <= 0) { this.send(); ep.spawnIn = 0.8 + Math.random() * 0.8; }
      if (ep.done >= this.N) { ep.state = "hold"; ep.holdUntil = this.T + 1.0; }
    } else if (ep.state === "hold" && this.T >= ep.holdUntil) {
      ep.state = "reveal"; ep.revealAt = this.T; ep.holdUntil = this.T + 3.4;
      if (this.hooks.onReveal) this.hooks.onReveal({ value: ep.value, informed: ep.informed, n: this.N });
    } else if (ep.state === "reveal" && this.T >= ep.holdUntil) {
      if (this.hooks.onNext) this.hooks.onNext();
      this.newEpisode(false);
    }
    for (const tr of this.traders) {
      tr.age += dt; tr.x -= 300 * dt;
      tr.trail.push({ x: tr.x, y: this.yOf(tr.ep.p * 100) + Math.sin(tr.age * 7 + tr.wob) * 6 }); if (tr.trail.length > 18) tr.trail.shift();
      if (!tr.done && tr.x <= this.nowX) { tr.done = true; this.resolve(tr); }
    }
    this.traders = this.traders.filter(t => !t.done);
    for (const b of this.bursts) { b.x += b.vx * dt - this.speed * dt; b.y += b.vy * dt; b.vx *= 0.94; b.vy *= 0.94; b.life -= dt; }
    this.bursts = this.bursts.filter(b => b.life > 0);
    for (const l of this.labels) { l.x -= this.speed * dt; l.y -= 18 * dt; l.life -= dt; }
    this.labels = this.labels.filter(l => l.life > 0);
    const cut = this.T - (this.nowX + 40) / this.speed;
    while (this.hist.length > 2 && this.hist[1].t < cut) this.hist.shift();
    while (this.eps.length > 1 && this.eps[0].events.length && this.eps[0].events[this.eps[0].events.length - 1].t < cut) this.eps.shift();
  }

  /* ---------------------------------------------------------------- draw */
  stairs(key, closeBack) {
    const g = this.g, h = this.hist, last = h[h.length - 1];
    const f = v => key === "p" ? this.yOf(v * 100) : this.yOf(v);
    g.beginPath();
    h.forEach((pt, i) => {
      const x = this.xOf(pt.t), y = f(pt[key]);
      if (i === 0) g.moveTo(x, y);
      else { g.lineTo(x, f(h[i - 1][key])); g.lineTo(x, y); }
    });
    g.lineTo(this.nowX, f(last[key]));
  }
  draw() {
    const g = this.g, c = this.c, W = this.W, H = this.H, nx = this.nowX;
    g.clearRect(0, 0, W, H);
    g.font = "500 12px 'IBM Plex Sans', system-ui, sans-serif"; g.textBaseline = "middle";
    // grid
    [0, 25, 50, 75, 100].forEach(v => {
      const y = this.yOf(v);
      g.strokeStyle = c.rule; g.globalAlpha = v === 50 ? 0.9 : 0.45; g.lineWidth = 1; g.setLineDash(v === 50 ? [] : [2, 5]);
      g.beginPath(); g.moveTo(34, y); g.lineTo(W, y); g.stroke();
      g.globalAlpha = 1; g.setLineDash([]); g.fillStyle = c.dim; g.textAlign = "left"; g.fillText(String(v), 6, y);
    });
    // episode dividers
    for (const ep of this.eps) { const x = this.xOf(ep.t0); if (x > 34 && x < nx) { g.strokeStyle = c.dim; g.globalAlpha = 0.5; g.setLineDash([3, 4]); g.beginPath(); g.moveTo(x, 8); g.lineTo(x, H - 8); g.stroke(); g.setLineDash([]); g.globalAlpha = 1; g.fillStyle = c.dim; g.textAlign = "left"; g.fillText("new asset", x + 6, H - 14); } }
    g.save(); g.beginPath(); g.rect(34, 0, nx - 34 + 1, H); g.clip();
    // rival band
    g.beginPath();
    this.hist.forEach((pt, i) => { const x = this.xOf(pt.t); if (i === 0) g.moveTo(x, this.yOf(pt.ra)); else { g.lineTo(x, this.yOf(this.hist[i - 1].ra)); g.lineTo(x, this.yOf(pt.ra)); } });
    const L = this.hist[this.hist.length - 1]; g.lineTo(nx, this.yOf(L.ra));
    for (let i = this.hist.length - 1; i >= 0; i--) {
      const pt = this.hist[i], x = this.xOf(pt.t);
      if (i === this.hist.length - 1) g.lineTo(nx, this.yOf(pt.rb));
      g.lineTo(x, this.yOf(pt.rb));
      if (i > 0) g.lineTo(x, this.yOf(this.hist[i - 1].rb));
    }
    g.closePath(); g.fillStyle = c.dim; g.globalAlpha = 0.14; g.fill(); g.globalAlpha = 1;
    // revealed true value + informed rings
    for (const ep of this.eps) {
      if (ep.revealAt == null) continue;
      const x0 = Math.max(34, this.xOf(ep.t0)), y = this.yOf(ep.value), col = ep.value === 100 ? c.buy : c.sell;
      g.strokeStyle = col; g.globalAlpha = 0.9; g.lineWidth = 1.5; g.setLineDash([6, 5]); g.beginPath(); g.moveTo(x0, y); g.lineTo(nx, y); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
      g.fillStyle = col; g.textAlign = "left"; g.fillText("true value " + ep.value, x0 + 8, y + (ep.value === 100 ? 14 : -14));
    }
    // belief line (fair value)
    g.lineJoin = "round"; g.strokeStyle = c.paper; g.lineWidth = 2.6; g.shadowColor = c.amber; g.shadowBlur = 14;
    this.stairs("p"); g.stroke(); g.shadowBlur = 0;
    // fills
    for (const pt of this.hist) {
      if (!pt.ev) continue; const e = pt.ev, x = this.xOf(pt.t), y = this.yOf(e.price), col = e.filler === "rival" ? c.dim : e.edge >= 0 ? c.buy : c.sell;
      const ep = this.eps.find(q => q.events.includes(e));
      if (ep && ep.revealAt != null && e.informed) { g.strokeStyle = c.amber; g.lineWidth = 2.5; g.beginPath(); g.arc(x, y, 9, 0, 6.283); g.stroke(); }
      g.beginPath(); g.arc(x, y, 4.2, 0, 6.283);
      if (e.filler === "you") { g.fillStyle = col; g.fill(); } else { g.strokeStyle = col; g.lineWidth = 1.8; g.stroke(); }
    }
    g.restore();
    // now line
    g.strokeStyle = c.paper; g.globalAlpha = 0.35; g.lineWidth = 1; g.beginPath(); g.moveTo(nx, 6); g.lineTo(nx, H - 6); g.stroke(); g.globalAlpha = 1;
    // current quotes to the right
    const q = rivalQuotes(this.ep.p), yq = this.youQuotes();
    const tag = (price, col, label, solid) => {
      const y = this.yOf(price); g.strokeStyle = col; g.lineWidth = solid ? 2 : 1.4; g.globalAlpha = solid ? 1 : 0.8; g.setLineDash(solid ? [] : [5, 4]);
      g.beginPath(); g.moveTo(nx, y); g.lineTo(W - 58, y); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
      g.fillStyle = col; g.fillRect(W - 58, y - 10, 54, 20);
      g.fillStyle = c.tile; g.textAlign = "center"; g.font = "600 12px 'IBM Plex Sans', sans-serif"; g.fillText(label + " " + price, W - 31, y + 0.5); g.font = "500 12px 'IBM Plex Sans', sans-serif";
    };
    tag(q.ra, c.dim, "ask", false); tag(q.rb, c.dim, "bid", false);
    if (yq) {
      g.fillStyle = c.paper; g.globalAlpha = 0.07; g.fillRect(nx, this.yOf(yq.ask), W - 58 - nx, this.yOf(yq.bid) - this.yOf(yq.ask)); g.globalAlpha = 1;
      tag(yq.ask, c.sell, "ask", true); tag(yq.bid, c.buy, "bid", true);
    }
    // traders
    for (const tr of this.traders) {
      g.lineCap = "round";
      for (let i = 1; i < tr.trail.length; i++) { g.strokeStyle = c.paper; g.globalAlpha = i / tr.trail.length * 0.35; g.lineWidth = 3; g.beginPath(); g.moveTo(tr.trail[i - 1].x, tr.trail[i - 1].y); g.lineTo(tr.trail[i].x, tr.trail[i].y); g.stroke(); }
      g.globalAlpha = 1; const p = tr.trail[tr.trail.length - 1]; if (!p) continue;
      g.shadowColor = c.paper; g.shadowBlur = 16; g.fillStyle = c.paper; g.beginPath(); g.arc(p.x, p.y, 6, 0, 6.283); g.fill(); g.shadowBlur = 0;
    }
    // bursts and labels
    for (const b of this.bursts) { g.globalAlpha = Math.max(0, b.life / 0.7); g.fillStyle = b.col; g.beginPath(); g.arc(b.x, b.y, 3, 0, 6.283); g.fill(); }
    g.globalAlpha = 1; g.font = "600 14px 'IBM Plex Sans', system-ui, sans-serif"; g.textAlign = "center";
    for (const l of this.labels) {
      g.globalAlpha = Math.min(1, l.life * 1.6); g.textAlign = "right";
      const w = g.measureText(l.text).width;
      if (l.pill) { g.fillStyle = "rgba(10,11,14,.72)"; g.beginPath(); if (g.roundRect) g.roundRect(l.x - w - 14, l.y - 15, w + 16, 22, 11); else g.rect(l.x - w - 14, l.y - 15, w + 16, 22); g.fill(); g.strokeStyle = l.col; g.lineWidth = 1; g.globalAlpha *= .8; g.stroke(); g.globalAlpha = Math.min(1, l.life * 1.6); }
      g.fillStyle = l.col; g.fillText(l.text, l.x - 6, l.y);
    }
    g.textAlign = "left";
    g.globalAlpha = 1;
  }
}
