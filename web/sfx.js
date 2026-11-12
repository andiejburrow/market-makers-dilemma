"use strict";
/* Small sound effects made with the browser's own audio. Off until the player turns them on. */
const SFX = (() => {
  let ctx = null, on = false, lastClack = 0, noise = null;
  try { on = localStorage.getItem("mmd-sound") === "1"; } catch (e) { /* storage may be blocked */ }
  const ensure = () => {
    if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) ctx = new AC(); }
    if (ctx && ctx.state === "suspended") ctx.resume();
    return ctx;
  };
  const tone = (freq, at, dur, { type = "sine", gain = 0.06, to = null } = {}) => {
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + at;
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + dur + 0.02);
  };
  document.addEventListener("pointerdown", () => { if (on) ensure(); }, { passive: true });
  return {
    get on() { return on; },
    set(v) {
      on = !!v;
      try { localStorage.setItem("mmd-sound", on ? "1" : "0"); } catch (e) { /* ignore */ }
      if (on && ensure()) tone(740, 0, 0.12, { gain: 0.05 });
    },
    clack() {                       // a split-flap tile turning over
      if (!on || !ctx) return;
      const now = performance.now(); if (now - lastClack < 30) return; lastClack = now;
      if (!noise) { noise = ctx.createBuffer(1, ctx.sampleRate * 0.03, ctx.sampleRate); const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length); }
      const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = noise; f.type = "bandpass"; f.frequency.value = 2200 + Math.random() * 900; f.Q.value = 1.2; g.gain.value = 0.16;
      s.connect(f).connect(g).connect(ctx.destination); s.start();
    },
    fill(kind) {                    // "good" and "bad" are your fills; "rival" is the rival's
      if (!on || !ensure()) return;
      if (kind === "good") { tone(660, 0, 0.14, { gain: 0.06 }); tone(990, 0.09, 0.2, { gain: 0.06 }); }
      else if (kind === "bad") { tone(330, 0, 0.16, { gain: 0.06, type: "triangle" }); tone(220, 0.1, 0.24, { gain: 0.06, type: "triangle" }); }
      else tone(520, 0, 0.07, { gain: 0.025, type: "triangle" });
    },
    reveal() {
      if (!on || !ensure()) return;
      [392, 494, 587].forEach((f, i) => tone(f, i * 0.07, 0.6, { gain: 0.04 }));
    },
  };
})();
