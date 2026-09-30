const test = require("node:test");
const assert = require("node:assert/strict");

// Capture the module definition by overriding Module.register before require,
// matching the pattern used by MMM-GlassClock's tests.
global.Module = { register: (_name, def) => { global.__mod = def; } };
global.Log = { info: () => {}, warn: () => {}, error: () => {} };

const makeClassList = (owner) => ({
  toggle(name, force) {
    const has = owner.classes.has(name);
    const shouldHave = force === undefined ? !has : force;
    if (shouldHave) owner.classes.add(name);
    else owner.classes.delete(name);
    return shouldHave;
  },
  contains(name) {
    return owner.classes.has(name);
  },
  add(name) {
    owner.classes.add(name);
  }
});

const makeBody = (classes = []) => {
  const body = { classes: new Set(classes) };
  body.classList = makeClassList(body);
  return body;
};

global.document = { body: makeBody() };
// Node >= 21 ships a built-in, non-writable global `navigator`; redefine it
// so tests can swap userAgent to simulate different devices.
const setUserAgent = (ua) => {
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent: ua },
    configurable: true,
    writable: true
  });
};
setUserAgent("test-runner");
global.window = { location: { origin: "http://localhost" } };

require("../MMM-AnimatedWeatherBackgrounds.js");
const mod = global.__mod;

const makeCtx = (overrides = {}) =>
  Object.assign(
    {
      config: mod.defaults,
      sunTimes: { sunrise: null, sunset: null },
      pageNight: null
    },
    overrides
  );

// ---------------------------------------------------------------------------
// resolveNightFlag: explicit hint > sunTimes > page theme > local-time fallback
// ---------------------------------------------------------------------------

test("resolveNightFlag: explicit boolean hint wins over everything else", () => {
  const ctx = makeCtx({ sunTimes: { sunrise: Date.now() - 1000, sunset: Date.now() + 1000 }, pageNight: false });
  assert.equal(mod.resolveNightFlag.call(ctx, true), true);
  assert.equal(mod.resolveNightFlag.call(ctx, false), false);
});

test("resolveNightFlag: sunTimes decide when no explicit hint is given", () => {
  const now = Date.now();
  const daytime = makeCtx({ sunTimes: { sunrise: now - 1000, sunset: now + 1000 }, pageNight: true });
  assert.equal(mod.resolveNightFlag.call(daytime, null), false);

  const nighttime = makeCtx({ sunTimes: { sunrise: now + 1000, sunset: now + 2000 }, pageNight: false });
  assert.equal(mod.resolveNightFlag.call(nighttime, null), true);
});

test("resolveNightFlag: falls back to the page theme when there is no hint or sun data", () => {
  const dayCtx = makeCtx({ pageNight: false });
  assert.equal(mod.resolveNightFlag.call(dayCtx, null), false);

  const nightCtx = makeCtx({ pageNight: true });
  assert.equal(mod.resolveNightFlag.call(nightCtx, null), true);
});

test("resolveNightFlag: local-time guess is the last resort", () => {
  const ctx = makeCtx({ pageNight: null });
  const result = mod.resolveNightFlag.call(ctx, null);
  assert.equal(typeof result, "boolean");
});

// ---------------------------------------------------------------------------
// normalizeWeather: isNightHint must be a tri-state, not "includes night or false"
// ---------------------------------------------------------------------------

test("normalizeWeather: cloudy/rain/snow types without day/night in the name give a null hint, not false", () => {
  assert.equal(mod.normalizeWeather("cloudy").isNightHint, null);
  assert.equal(mod.normalizeWeather("rain").isNightHint, null);
  assert.equal(mod.normalizeWeather("snow").isNightHint, null);
});

test("normalizeWeather: explicit day/night in the type string sets the hint", () => {
  assert.equal(mod.normalizeWeather("clear-night").isNightHint, true);
  assert.equal(mod.normalizeWeather("clear-day").isNightHint, false);
});

// ---------------------------------------------------------------------------
// PAGE_THEME_CHANGED handling
// ---------------------------------------------------------------------------

test("handlePageThemeChanged: stores the page mode and re-applies when nothing more specific is known", () => {
  let applied = null;
  const ctx = makeCtx({
    scene: "cloudy",
    lastIsNightHint: null,
    sunTimes: { sunrise: null, sunset: null },
    applyScene(scene, isNight) {
      applied = { scene, isNight };
    },
    resolveNightFlag: mod.resolveNightFlag
  });

  mod.handlePageThemeChanged.call(ctx, { mode: "night" });

  assert.equal(ctx.pageNight, true);
  assert.deepEqual(applied, { scene: "cloudy", isNight: true });
});

test("notificationReceived: the literal \"PAGE_THEME_CHANGED\" notification reaches handlePageThemeChanged", () => {
  // Regression guard for the r2 name-mismatch scare: dispatch through the real
  // notificationReceived switch (not by calling handlePageThemeChanged directly)
  // with the exact string MMM-GlassClock sends, so a future rename of either
  // side's listener/sender breaks this test.
  let applied = null;
  const ctx = makeCtx({
    scene: "cloudy",
    lastIsNightHint: null,
    sunTimes: { sunrise: null, sunset: null },
    handlePageThemeChanged: mod.handlePageThemeChanged,
    applyScene(scene, isNight) {
      applied = { scene, isNight };
    },
    resolveNightFlag: mod.resolveNightFlag
  });

  mod.notificationReceived.call(ctx, "PAGE_THEME_CHANGED", { mode: "night" }, { name: "MMM-GlassClock" });

  assert.equal(ctx.pageNight, true);
  assert.deepEqual(applied, { scene: "cloudy", isNight: true });
});

test("handlePageThemeChanged: does not override an explicit weather-driven night hint", () => {
  let applyCount = 0;
  const ctx = makeCtx({
    scene: "clear",
    lastIsNightHint: false,
    sunTimes: { sunrise: null, sunset: null },
    applyScene() {
      applyCount += 1;
    }
  });

  mod.handlePageThemeChanged.call(ctx, { mode: "night" });

  assert.equal(ctx.pageNight, true);
  assert.equal(applyCount, 0);
});

// ---------------------------------------------------------------------------
// Pi performance profile
// ---------------------------------------------------------------------------

test("resolvePerformanceProfile: explicit config wins over user-agent sniffing", () => {
  const ctx = makeCtx({ config: { performanceProfile: "pi" } });
  assert.equal(mod.resolvePerformanceProfile.call(ctx), "pi");
});

test("resolvePerformanceProfile: auto detects a Pi from the user agent", () => {
  setUserAgent("Mozilla/5.0 (X11; Linux armv7l) raspberry");
  const ctx = makeCtx({ config: { performanceProfile: "auto" } });
  assert.equal(mod.resolvePerformanceProfile.call(ctx), "pi");
  setUserAgent("test-runner");
});

test("resolvePerformanceProfile: auto defaults to full on a desktop user agent", () => {
  setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
  const ctx = makeCtx({ config: { performanceProfile: "auto" } });
  assert.equal(mod.resolvePerformanceProfile.call(ctx), "full");
  setUserAgent("test-runner");
});

// ---------------------------------------------------------------------------
// start(): seeds pageNight from body classes before any notification arrives
// ---------------------------------------------------------------------------

test("start(): seeds pageNight from an existing body.mm-night class", () => {
  global.document = { body: makeBody(["mm-night"]) };
  const ctx = {
    config: mod.defaults,
    applyScene() {},
    resolvePerformanceProfile: mod.resolvePerformanceProfile,
    resolveCrossfade: mod.resolveCrossfade,
    resolveNightFlag: mod.resolveNightFlag
  };
  mod.start.call(ctx);
  assert.equal(ctx.pageNight, true);
});

test("start(): seeds pageNight from an existing body.mm-day class", () => {
  global.document = { body: makeBody(["mm-day"]) };
  const ctx = {
    config: mod.defaults,
    applyScene() {},
    resolvePerformanceProfile: mod.resolvePerformanceProfile,
    resolveCrossfade: mod.resolveCrossfade,
    resolveNightFlag: mod.resolveNightFlag
  };
  mod.start.call(ctx);
  assert.equal(ctx.pageNight, false);
});

// ---------------------------------------------------------------------------
// reduceMotion: canplay must not re-arm itself (Chromium re-fires canplay
// after a currentTime seek, which would otherwise loop forever)
// ---------------------------------------------------------------------------

const makeMockLayer = () => {
  const classes = new Set();
  return {
    style: {},
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); }
    },
    currentSrc: "",
    src: "",
    load() {},
    oncanplay: null,
    play() {
      return Promise.resolve();
    },
    pause() {
      this._paused = true;
    },
    removeAttribute(name) {
      if (name === "src") this.src = "";
    }
  };
};

test("applySprite: reduceMotion's canplay handler clears itself and only pauses (no re-seek loop)", () => {
  const layerA = makeMockLayer();
  const layerB = makeMockLayer();

  const ctx = makeCtx({
    videoEls: [layerA, layerB],
    activeLayer: 0,
    fade: null,
    reduceMotion: true,
    crossfade: true,
    suspended: false,
    spriteUrl: "videos/clear-day.mp4",
    spriteMeta: { type: "video", playbackRate: 1 },
    loadIntoLayer: mod.loadIntoLayer,
    startCrossfade: mod.startCrossfade,
    cancelFade: mod.cancelFade,
    releaseLayer: mod.releaseLayer
  });

  mod.applySprite.call(ctx);

  // First-ever load onto an empty layer is a direct load (nothing to
  // crossfade from yet), so the handler lands on the active layer.
  const handler = layerA.oncanplay;
  assert.equal(typeof handler, "function");
  handler();

  // The handler must have unset itself before/while running so a second
  // "canplay" (fired by the browser after the currentTime seek completes)
  // is a no-op instead of re-triggering another seek.
  assert.equal(layerA.oncanplay, null);
  assert.equal(layerA._paused, true);
});

// ---------------------------------------------------------------------------
// AMBIENT_WEATHER_DATA: isDaytime is only trustworthy alongside real sun times
// ---------------------------------------------------------------------------

test("handleAmbientWeather: isDaytime is ignored when sunrise/sunset are missing (falls back to null hint)", () => {
  let appliedIsNight = null;
  const ctx = makeCtx({
    manualOverride: null,
    sunTimes: { sunrise: null, sunset: null },
    pageNight: true,
    resolveNightFlag: mod.resolveNightFlag,
    normalizeWeather: mod.normalizeWeather,
    parseTimestamp: mod.parseTimestamp,
    applyScene(scene, isNight) {
      appliedIsNight = isNight;
    }
  });

  // MMM-AmbientWeather's node_helper defaults isDaytime to true when it has no
  // lat/long to compute real sun times - that default must not override a
  // known-better source (here, the page theme says night).
  mod.handleAmbientWeather.call(ctx, { condition: "cloud", isDaytime: true, sunrise: null, sunset: null });

  assert.equal(appliedIsNight, true);
});

test("handleAmbientWeather: isDaytime is trusted when sunrise and sunset are both present", () => {
  let appliedIsNight = null;
  const ctx = makeCtx({
    manualOverride: null,
    sunTimes: { sunrise: null, sunset: null },
    pageNight: true,
    resolveNightFlag: mod.resolveNightFlag,
    normalizeWeather: mod.normalizeWeather,
    parseTimestamp: mod.parseTimestamp,
    applyScene(scene, isNight) {
      appliedIsNight = isNight;
    }
  });

  mod.handleAmbientWeather.call(ctx, {
    condition: "cloud",
    isDaytime: true,
    sunrise: "2026-09-28T06:30:00.000Z",
    sunset: "2026-09-28T19:00:00.000Z"
  });

  assert.equal(appliedIsNight, false);
});
