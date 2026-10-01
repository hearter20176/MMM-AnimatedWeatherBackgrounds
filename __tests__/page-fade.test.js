const test = require("node:test");
const assert = require("node:assert/strict");

global.Module = { register: (_name, def) => { global.__mod = def; } };
global.Log = { info: () => {}, warn: () => {}, error: () => {} };
global.document = { body: { classList: { contains: () => false }, className: "" } };
global.window = { location: { origin: "http://localhost" } };
Object.defineProperty(globalThis, "navigator", {
  value: { userAgent: "test-runner" },
  configurable: true,
  writable: true
});

require("../MMM-AnimatedWeatherBackgrounds.js");
const mod = global.__mod;

const makeVideoEl = (visible = true) => {
  const classes = new Set(visible ? ["is-visible"] : []);
  return {
    _paused: false,
    playCalls: 0,
    get paused() { return this._paused; },
    play() { this._paused = false; this.playCalls += 1; return Promise.resolve(); },
    pause() { this._paused = true; },
    classList: { contains: (n) => classes.has(n), add: (n) => classes.add(n), remove: (n) => classes.delete(n) }
  };
};

// Simulates MM 2.33 module.hide()/show(): hide sets hidden=true and calls suspend()
// after `speed`; show cancels any pending hide timer, sets hidden=false (unless a
// lockString refuses it) and calls resume() after `speed`. Manual clock.
const makeHarness = (overrides = {}) => {
  const clock = { now: 0, timers: [] };
  const ctx = Object.assign(
    {
      name: "MMM-AnimatedWeatherBackgrounds",
      config: Object.assign({}, mod.defaults),
      videoEls: [makeVideoEl(true), makeVideoEl(false)],
      activeLayer: 0,
      fade: null,
      suspended: false,
      reduceMotion: false,
      hidden: false,
      locked: false,
      speeds: [],
      resolveFadeSpeed: mod.resolveFadeSpeed,
      startPlayback: mod.startPlayback,
      suspend: mod.suspend,
      resume: mod.resume
    },
    overrides
  );
  let hideTimer = null;
  let showTimer = null;
  const schedule = (fn, ms) => {
    const t = { at: clock.now + ms, fn, cancelled: false };
    clock.timers.push(t);
    return t;
  };
  ctx.tick = (ms) => {
    clock.now += ms;
    clock.timers.filter((t) => t.at <= clock.now && !t.cancelled).forEach((t) => {
      t.cancelled = true;
      t.fn();
    });
  };
  ctx.hide = (speed) => {
    ctx._super = (s) => {
      ctx.speeds.push(s);
      ctx.hidden = true;
      if (showTimer) showTimer.cancelled = true;
      hideTimer = schedule(() => ctx.suspend(), s);
    };
    mod.hide.call(ctx, speed);
  };
  ctx.show = (speed) => {
    ctx._super = (s) => {
      ctx.speeds.push(s);
      if (ctx.locked) return;
      if (hideTimer) hideTimer.cancelled = true;
      ctx.hidden = false;
      showTimer = schedule(() => ctx.resume(), s);
    };
    mod.show.call(ctx, speed);
  };
  ctx.video = () => ctx.videoEls[0];
  return ctx;
};

test("hide: wrapper fade is stretched to pageFadeDuration; video keeps playing during fade-out, then pauses", () => {
  const ctx = makeHarness();
  ctx.hide(500);
  assert.deepEqual(ctx.speeds, [1500]);
  ctx.tick(1499);
  assert.equal(ctx.video().paused, false, "must still be playing while fading out");
  ctx.tick(1);
  assert.equal(ctx.video().paused, true);
  assert.equal(ctx.suspended, true);
});

test("show: playback starts at the start of the fade-in, not after it", () => {
  const ctx = makeHarness();
  ctx.hide(500);
  ctx.tick(1500);
  assert.equal(ctx.video().paused, true);
  ctx.show(500);
  assert.deepEqual(ctx.speeds, [1500, 1500]);
  assert.equal(ctx.video().paused, false, "playing immediately on show");
  assert.equal(ctx.suspended, false);
  const plays = ctx.video().playCalls;
  ctx.tick(1500); // resume() fires at the end of the fade: harmless no-op
  assert.equal(ctx.video().playCalls, plays);
  assert.equal(ctx.video().paused, false);
});

test("show refused by a lockString does not start playback", () => {
  const ctx = makeHarness();
  ctx.hide(500);
  ctx.tick(1500);
  ctx.locked = true;
  ctx.show(500);
  assert.equal(ctx.video().paused, true);
  assert.equal(ctx.suspended, true);
});

test("rapid hide/show/hide never leaves the video playing while hidden", () => {
  const ctx = makeHarness();
  ctx.hide(500);
  ctx.tick(300);
  ctx.show(500);
  ctx.tick(200);
  ctx.hide(500);
  ctx.tick(1499);
  assert.equal(ctx.video().paused, false);
  ctx.tick(1);
  assert.equal(ctx.video().paused, true);
  ctx.tick(5000);
  assert.equal(ctx.video().paused, true);
  assert.equal(ctx.hidden, true);
});

test("rapid hide/show/hide/show never leaves the video paused while shown", () => {
  const ctx = makeHarness();
  ctx.hide(500);
  ctx.tick(1500);
  ctx.show(500);
  ctx.tick(100);
  ctx.hide(500);
  ctx.tick(100);
  ctx.show(500);
  ctx.tick(10000);
  assert.equal(ctx.hidden, false);
  assert.equal(ctx.video().paused, false);
  assert.equal(ctx.suspended, false);
});

test("show interrupting a hide before suspend ran keeps the video playing", () => {
  const ctx = makeHarness();
  ctx.hide(500);
  ctx.tick(1000);
  ctx.show(500);
  ctx.tick(10000);
  assert.equal(ctx.video().paused, false);
});

test("suspend is ignored while the module is marked shown", () => {
  const ctx = makeHarness({ hidden: false });
  mod.suspend.call(ctx);
  assert.equal(ctx.video().paused, false);
  assert.equal(ctx.suspended, false);
});

test("pauseWhileHidden=false never pauses but still stretches the fade", () => {
  const ctx = makeHarness();
  ctx.config.pauseWhileHidden = false;
  ctx.hide(500);
  ctx.tick(2000);
  assert.deepEqual(ctx.speeds, [1500]);
  assert.equal(ctx.video().paused, false);
});

test("resolveFadeSpeed: custom duration, zero speed preserved, 0 disables override", () => {
  const ctx = makeHarness();
  ctx.config.pageFadeDuration = 2200;
  assert.equal(mod.resolveFadeSpeed.call(ctx, 500), 2200);
  assert.equal(mod.resolveFadeSpeed.call(ctx, 0), 0);
  assert.equal(mod.resolveFadeSpeed.call(ctx, undefined), undefined);
  ctx.config.pageFadeDuration = 0;
  assert.equal(mod.resolveFadeSpeed.call(ctx, 500), 500);
});

test("reduceMotion: hide/show are instant and nothing is played on show", () => {
  const ctx = makeHarness({ reduceMotion: true });
  ctx.hide(500);
  ctx.tick(0);
  assert.deepEqual(ctx.speeds, [0]);
  ctx.video().pause();
  ctx.show(500);
  assert.deepEqual(ctx.speeds, [0, 0]);
  assert.equal(ctx.video().paused, true, "reduceMotion never decodes a running video");
});

test("show does not reload the source (only play() is called)", () => {
  const ctx = makeHarness();
  const el = ctx.video();
  el.load = () => { throw new Error("load must not be called"); };
  el.removeAttribute = () => { throw new Error("removeAttribute must not be called"); };
  ctx.hide(500);
  ctx.tick(1500);
  ctx.show(500);
  assert.equal(el.paused, false);
});

test("show during an in-progress scene crossfade resumes both layers", () => {
  const ctx = makeHarness();
  const [a, b] = ctx.videoEls;
  b.classList.add("is-visible");
  ctx.fade = { fromEl: a, toEl: b };
  ctx.hide(500);
  ctx.tick(1500);
  assert.equal(a.paused && b.paused, true);
  ctx.show(500);
  assert.equal(a.paused, false);
  assert.equal(b.paused, false);
});

test("hide/show pass the callback and options (lockString) through to MagicMirror unchanged", () => {
  const ctx = makeHarness();
  const calls = [];
  ctx._super = (...args) => calls.push(args);
  const cb = () => {};
  const opts = { lockString: "module_11_MMM-pages" };
  mod.hide.call(ctx, 500, cb, opts);
  mod.show.call(ctx, 500, cb, opts);
  assert.equal(calls.length, 2);
  for (const [speed, callback, options] of calls) {
    assert.equal(speed, 1500);
    assert.equal(callback, cb);
    assert.equal(options, opts);
  }
});
