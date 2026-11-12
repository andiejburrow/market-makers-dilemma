"use strict";
/* Split-flap display. Each character is a tile that flips like an old exchange board. */
const REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const LETTERS = " ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const isDigit = c => c >= "0" && c <= "9";
const rnd = s => s[Math.floor(Math.random() * s.length)];

class Tile {
  constructor() {
    const d = (cls) => { const h = document.createElement("span"); h.className = "half " + cls; h.appendChild(document.createElement("i")); return h; };
    this.el = document.createElement("span"); this.el.className = "tile"; this.el.setAttribute("aria-hidden", "true");
    this.t = d("t"); this.b = d("b"); this.ft = d("t ft"); this.fb = d("b fb");
    this.el.append(this.t, this.b, this.ft, this.fb);
    this.cur = " "; this.queue = []; this.busy = false;
    this.paint(" ");
  }
  paint(ch) { [this.t, this.b, this.ft, this.fb].forEach(h => { h.firstChild.textContent = ch === " " ? " " : ch; }); }
  set(ch, spin = 0) {
    if (REDUCED) { this.cur = ch; this.queue = []; this.paint(ch); return; }
    const q = [];
    if (spin > 0) { for (let i = 0; i < spin; i++) q.push(isDigit(ch) ? rnd("0123456789") : rnd(LETTERS)); }
    else if (isDigit(ch) && isDigit(this.cur)) {
      const c = +this.cur, t = +ch, dist = (t - c + 10) % 10;
      for (let k = Math.min(dist, 3) - 1; k >= 0; k--) q.push(String((t - k + 10) % 10));
      if (!dist) return;
    }
    if (!q.length || q[q.length - 1] !== ch) q.push(ch);
    this.queue = q;
    this.run();
  }
  async run() {
    if (this.busy) return;
    this.busy = true;
    while (this.queue.length) {
      const nx = this.queue.shift();
      if (nx !== this.cur) await this.flip(this.cur, nx);
      this.cur = nx;
    }
    this.busy = false;
  }
  async flip(a, b) {
    const fix = c => (c === " " ? " " : c);
    this.t.firstChild.textContent = fix(b); this.ft.firstChild.textContent = fix(a);
    this.fb.firstChild.textContent = fix(b); this.b.firstChild.textContent = fix(a);
    if (typeof SFX !== "undefined") SFX.clack();
    this.ft.style.visibility = "visible";
    try {
      await this.ft.animate([{ transform: "rotateX(0deg)" }, { transform: "rotateX(-90deg)" }], { duration: 65, easing: "ease-in" }).finished;
      this.ft.style.visibility = "hidden";
      this.fb.style.visibility = "visible";
      await this.fb.animate([{ transform: "rotateX(90deg)" }, { transform: "rotateX(0deg)" }], { duration: 65, easing: "ease-out" }).finished;
    } catch (e) { /* animation cancelled */ }
    this.fb.style.visibility = "hidden";
    this.b.firstChild.textContent = fix(b);
  }
}

class Flap {
  constructor(width, { fs = 80, tone = "" } = {}) {
    this.width = width;
    this.el = document.createElement("span");
    this.el.className = "flap " + tone;
    this.el.style.setProperty("--fs", fs + "px");
    this.el.setAttribute("role", "img");
    this.tiles = Array.from({ length: width }, () => { const t = new Tile(); this.el.appendChild(t.el); return t; });
    this.text = "";
  }
  set(text, { spin = 0, stagger = 0, tone } = {}) {
    text = String(text).slice(-this.width).padStart(this.width, " ");
    if (tone !== undefined) this.el.className = "flap " + tone;
    this.text = text;
    this.el.setAttribute("aria-label", text.trim());
    this.tiles.forEach((t, i) => {
      if (stagger) setTimeout(() => t.set(text[i], spin), i * stagger);
      else t.set(text[i], spin);
    });
    return this;
  }
}
