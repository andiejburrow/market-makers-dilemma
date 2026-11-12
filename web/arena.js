"use strict";
/* The price rail: drag your bid and ask, watch traders fly in and hit a price. */
const NS = "http://www.w3.org/2000/svg";
const S = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
};
const V = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wait = ms => new Promise(r => setTimeout(r, ms));
const MINUS_ = "−";

class Arena {
  constructor(onChange) {
    this.onChange = onChange;
    this.X0 = 40; this.X1 = 960; this.RY = 150; this.IDLE = { x: 500, y: 228 };
    this.bid = 30; this.ask = 70;
    const svg = this.svg = S("svg", { viewBox: "0 0 1000 250", class: "arena", role: "group", "aria-label": "Price rail from 0 to 100. Drag the green and red flags to set your bid and ask." });
    const defs = S("defs", {}, svg);
    const g = S("linearGradient", { id: "zg", x1: 0, x2: 1, y1: 0, y2: 0 }, defs);
    S("stop", { offset: "0", "stop-color": V("--buy-hi"), "stop-opacity": ".30" }, g);
    S("stop", { offset: "1", "stop-color": V("--sell-hi"), "stop-opacity": ".30" }, g);
    this.zone = S("rect", { class: "zone", y: 92, height: 58, rx: 4, fill: "url(#zg)" }, svg);
    for (let p = 0; p <= 100; p += 10) {
      const x = this.x(p);
      S("line", { class: "tick", x1: x, x2: x, y1: this.RY, y2: this.RY + 9 }, svg);
      const t = S("text", { x, y: this.RY + 28, "text-anchor": "middle" }, svg); t.textContent = p;
    }
    S("line", { class: "axis", x1: this.X0, x2: this.X1, y1: this.RY, y2: this.RY }, svg);
    this.refG = S("g", {}, svg);
    this.tapeG = S("g", {}, svg);
    this.burstG = S("g", {}, svg);
    this.beliefG = S("g", { class: "belief" }, svg);
    S("line", { x1: 0, x2: 0, y1: 26, y2: this.RY, stroke: V("--amber-hi"), "stroke-width": 2, "stroke-dasharray": "4 5" }, this.beliefG);
    S("circle", { cx: 0, cy: this.RY, r: 6, fill: V("--amber-hi") }, this.beliefG);
    this.beliefT = S("text", { x: 0, y: 16, "text-anchor": "middle" }, this.beliefG);
    this.beliefG.style.transform = `translateX(${this.x(50)}px)`;
    this.flags = { bid: this.makeFlag("bid", V("--buy-hi")), ask: this.makeFlag("ask", V("--sell-hi")) };
    this.orbWrap = S("g", { class: "orbwrap" }, svg);
    this.orb = S("g", {}, this.orbWrap);
    this.orb.style.transform = `translate(${this.IDLE.x}px, ${this.IDLE.y}px)`;
    const inner = S("g", { class: "bob" }, this.orb);
    S("circle", { class: "pulse", r: 12, fill: "none", stroke: V("--paper"), "stroke-width": 2 }, inner);
    S("circle", { r: 12, fill: V("--paper") }, inner);
    const q = S("text", { y: 5, "text-anchor": "middle", style: `fill:${V("--tile")};font:700 17px ${V("--digits")}` }, inner); q.textContent = "?";
    this.orbLabel = S("text", { x: 24, y: 5 }, this.orb);
    this.drag = null;
    svg.addEventListener("pointermove", e => this.move(e));
    svg.addEventListener("pointerup", e => this.up(e));
    svg.addEventListener("pointercancel", e => this.up(e));
    this.layout();
  }
  x(p) { return this.X0 + (this.X1 - this.X0) * p / 100; }
  priceAt(clientX) {
    const r = this.svg.getBoundingClientRect();
    return Math.round(clamp(((clientX - r.left) * 1000 / r.width - this.X0) / (this.X1 - this.X0) * 100, 0, 100));
  }
  makeFlag(side, color) {
    const grp = S("g", { class: "knob", tabindex: 0, role: "slider", "aria-label": side === "bid" ? "Bid" : "Ask", "aria-valuemin": 0, "aria-valuemax": 100 }, this.svg);
    S("line", { class: "pole", y1: 56, y2: this.RY, stroke: color, "stroke-width": 3 }, grp);
    const rect = S("rect", { y: 22, width: 82, height: 36, rx: 5, fill: color }, grp);
    const txt = S("text", { class: "flagtxt", y: 47 }, grp);
    const hit = S("rect", { y: 14, width: 100, height: this.RY - 4, fill: "transparent" }, grp);
    const kc = S("circle", { class: "kc", cy: this.RY, r: 11, fill: color, stroke: V("--tile"), "stroke-width": 3 }, grp);
    grp.addEventListener("pointerdown", e => {
      if (this.locked) return;
      e.preventDefault(); grp.focus({ preventScroll: true });
      this.drag = side; this.svg.setPointerCapture(e.pointerId);
    });
    grp.addEventListener("keydown", e => {
      if (this.locked) return;
      const step = e.shiftKey ? 5 : 1;
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); this.setSide(side, this[side] - step, true); }
      if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); this.setSide(side, this[side] + step, true); }
    });
    return { grp, rect, txt, hit };
  }
  move(e) { if (this.drag) this.setSide(this.drag, this.priceAt(e.clientX), true); }
  up(e) { if (this.drag) { this.drag = null; try { this.svg.releasePointerCapture(e.pointerId); } catch (_) {} } }
  setSide(side, v, emit) {
    v = Math.round(v);
    if (side === "bid") v = clamp(v, 0, this.ask); else v = clamp(v, this.bid, 100);
    if (this[side] === v && !emit) return;
    this[side] = v;
    this.layout();
    if (emit && this.onChange) this.onChange(side, v);
  }
  setQuotes(bid, ask) { this.bid = clamp(+bid, 0, 100); this.ask = clamp(+ask, this.bid, 100); this.layout(); }
  layout() {
    const xb = this.x(this.bid), xa = this.x(this.ask);
    this.zone.setAttribute("x", xb); this.zone.setAttribute("width", Math.max(0, xa - xb));
    const place = (side, x, anchorLeft) => {
      const f = this.flags[side];
      f.grp.querySelector(".pole").setAttribute("x1", x); f.grp.querySelector(".pole").setAttribute("x2", x);
      f.grp.querySelector(".kc").setAttribute("cx", x);
      const rx = anchorLeft ? x - 82 : x;
      f.rect.setAttribute("x", rx); f.txt.setAttribute("x", rx + 41); f.txt.setAttribute("text-anchor", "middle");
      f.txt.textContent = (side === "bid" ? "Bid " : "Ask ") + this[side];
      f.hit.setAttribute("x", anchorLeft ? x - 100 : x - 0); f.hit.setAttribute("width", 100);
      f.grp.setAttribute("aria-valuenow", this[side]);
    };
    place("bid", xb, true); place("ask", xa, false);
    // knobs of the hit areas should not swallow the other flag: raise the one being dragged
    if (this.drag === "bid") this.svg.appendChild(this.flags.bid.grp);
  }
  setLocked(on) { this.locked = on; this.svg.classList.toggle("locked", on); }
  setRef(ref) {
    this.refG.replaceChildren();
    if (!ref) return;
    [["bid", ref.bid], ["ask", ref.ask]].forEach(([k, v]) => {
      const x = this.x(v);
      S("line", { x1: x, x2: x, y1: 100, y2: this.RY + 9, stroke: V("--amber-hi"), "stroke-width": 2 }, this.refG);
      S("path", { d: `M${x - 6},${this.RY + 4} L${x},${this.RY - 7} L${x + 6},${this.RY + 4} Z`, fill: V("--amber-hi") }, this.refG);
      const t = S("text", { class: "reftxt", x, y: this.RY + 50, "text-anchor": "middle" }, this.refG);
      t.textContent = (k === "bid" ? "break-even bid " : "break-even ask ") + v.toFixed(1);
    });
  }
  setBelief(pts, show = true) {
    this.beliefG.style.opacity = show && pts != null ? 1 : 0;
    if (pts == null) return;
    this.beliefG.style.transform = `translateX(${this.x(clamp(pts, 0, 100))}px)`;
    this.beliefT.textContent = `belief ${pts.toFixed(0)}%`;
  }
  setTape(tape) {
    this.tapeG.replaceChildren();
    const stack = {};
    tape.forEach(r => {
      const k = Math.round(r.price * 2), n = stack[k] = (stack[k] || 0) + 1;
      const x = this.x(r.price), y = this.RY - 9 - (n - 1) * 12;
      const mine = r.filler === "you", c = r.direction === "BUY" ? V("--buy-hi") : V("--sell-hi");
      S("circle", { cx: x, cy: y, r: 5, fill: mine ? c : "none", stroke: mine ? c : V("--dim"), "stroke-width": 2 }, this.tapeG);
    });
  }
  setOrb(on, arrival, total) {
    this.orb.getAnimations().forEach(a => a.cancel());
    this.orbWrap.style.opacity = on ? 1 : 0;
    this.orb.style.transform = `translate(${this.IDLE.x}px, ${this.IDLE.y}px)`;
    this.orbLabel.textContent = on ? `Trader ${arrival} of ${total} is waiting. Which way will they go?` : "";
  }
  sync(d, quotes) {
    this.setQuotes(quotes.bid, quotes.ask);
    this.setRef(d.reference);
    this.setBelief(d.last ? (d.last.direction === "BUY" ? d.last.ref_ask : d.last.ref_bid) : 50);
    this.setTape(d.tape);
    this.setOrb(!d.finished, d.arrival, d.n_arrivals);
    this.setLocked(d.finished);
  }
  /* Animate one trader flying to its fill price. Resolves when it is done. */
  async playFill(last, tape) {
    this.setLocked(true);
    this.orbLabel.textContent = "";
    const tx = this.x(last.price), buy = last.direction === "BUY", mine = last.filler === "you";
    const good = mine ? last.edge >= 0 : null;
    const col = !mine ? V("--dim") : good ? V("--buy-hi") : V("--sell-hi");
    if (REDUCED) { this.setTape(tape); return; }
    await this.orb.animate([
      { transform: `translate(${this.IDLE.x}px, ${this.IDLE.y}px)` },
      { transform: `translate(${(this.IDLE.x + tx) / 2}px, ${this.RY + 60}px)`, offset: .45 },
      { transform: `translate(${tx}px, ${this.RY - 9}px)` }], { duration: 620, easing: "cubic-bezier(.5,0,.2,1)", fill: "forwards" }).finished;
    this.orbWrap.style.opacity = 0;
    // burst
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2, r = 34 + Math.random() * 30;
      const c = S("circle", { cx: tx, cy: this.RY - 9, r: 3 + Math.random() * 2.5, fill: col }, this.burstG);
      c.animate([{ transform: "translate(0,0)", opacity: 1 }, { transform: `translate(${Math.cos(a) * r}px, ${Math.sin(a) * r}px)`, opacity: 0 }], { duration: 650, easing: "ease-out" })
        .finished.then(() => c.remove());
    }
    const lab = S("text", { x: tx, y: this.RY - 40, "text-anchor": "middle", style: `font:700 30px ${V("--digits")};fill:${col}` }, this.burstG);
    lab.textContent = mine ? (last.edge < -0.004 ? MINUS_ : "+") + Math.abs(last.edge).toFixed(2) : "rival";
    lab.animate([{ transform: "translateY(0)", opacity: 0 }, { transform: "translateY(-12px)", opacity: 1, offset: .25 }, { transform: "translateY(-34px)", opacity: 0 }], { duration: 1100, easing: "ease-out" }).finished.then(() => lab.remove());
    if (typeof SFX !== "undefined") SFX.fill(mine ? (good ? "good" : "bad") : "rival");
    this.setTape(tape);
    this.setBelief(buy ? last.ref_ask : last.ref_bid);
    if (mine) {
      const f = this.flags[buy ? "ask" : "bid"].grp.querySelector(".kc");
      f.animate([{ r: 11 }, { r: 22 }, { r: 11 }], { duration: 420 });
    }
    await wait(520);
  }
}
