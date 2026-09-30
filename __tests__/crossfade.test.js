const test = require("node:test");
const assert = require("node:assert/strict");

// Capture the module definition by overriding Module.register before require,
// matching the pattern used in night-and-performance.test.js.
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

// ---------------------------------------------------------------------------
// Fake <video> element
// ---------------------------------------------------------------------------
const makeClassList = (owner) => ({
  add(name) {
    owner.classes.add(name);
  },
  remove(name) {
    owner.classes.delete(name);
  },
  contains(name) {
    return owner.classes.has(name);
  }
});

let layerCounter = 0;
const makeVideoEl = () => {
  const el = {
    id: `layer-${layerCounter++}`,
    classes: new Set(),
    style: {},
    src: "",
    currentSrc: "",
    error: null,
    _paused: true,
    playbackRate: 1,
    playCalls: 0,
    pauseCalls: 0,
    loadCalls: 0,
    oncanplay: null,
    play() {
      this._paused = false;
      this.playCalls += 1;
      return Promise.resolve();
    },
    pause() {
      this._paused = true;
      this.pauseCalls += 1;
    },
    load() {
      this.loadCalls += 1;
    },
    removeAttribute(name) {
      if (name === "src") this.src = "";
    },
    getAttribute(name) {
      if (name === "src") return this.src || null;
      return null;
    },
    addEventListener() {},
    removeEventListener() {}
  };
  Object.defineProperty(el, "paused", { get() { return this._paused; } });
  el.classList = makeClassList(el);
  return el;
};

const makeCtx = (overrides = {}) => {
  const layerA = makeVideoEl();
  const layerB = makeVideoEl();
  return Object.assign(
    {
      name: "MMM-AnimatedWeatherBackgrounds",
      config: mod.defaults,
      videoEls: [layerA, layerB],
      activeLayer: 0,
      fade: null,
      scene: null,
      isNight: false,
      spriteUrl: null,
      spriteMeta: { type: "video", playbackRate: 1 },
      suspended: false,
      reduceMotion: false,
      crossfade: true,
      performanceProfile: "full",
      lookupSprite: mod.lookupSprite,
      isVideoUrl: mod.isVideoUrl,
      normalizeSpriteConfig: mod.normalizeSpriteConfig,
      resolveSpriteUrl: mod.resolveSpriteUrl,
      applySprite: mod.applySprite,
      loadIntoLayer: mod.loadIntoLayer,
      startCrossfade: mod.startCrossfade,
      cancelFade: mod.cancelFade,
      releaseLayer: mod.releaseLayer,
      handleLayerError: mod.handleLayerError,
      updateSprite: mod.updateSprite,
      file: (p) => `modules/MMM-AnimatedWeatherBackgrounds/${p}`
    },
    overrides
  );
};

// Load an initial scene directly (bypasses getDom) the way start()+getDom do:
// set scene bookkeeping, then run applySprite so layer 0 has content.
const seedInitialScene = (ctx, url = "videos/clear-day.mp4") => {
  ctx.scene = "clear";
  ctx.isNight = false;
  ctx.spriteUrl = url;
  ctx.spriteMeta = { type: "video", playbackRate: 1 };
  mod.applySprite.call(ctx);
};

// ---------------------------------------------------------------------------
// resolveCrossfade: auto vs forced true/false
// ---------------------------------------------------------------------------

test("resolveCrossfade: 'auto' resolves to a hard cut (false) when performanceProfile is 'pi'", () => {
  const ctx = { config: { crossfade: "auto" }, performanceProfile: "pi", reduceMotion: false };
  assert.equal(mod.resolveCrossfade.call(ctx), false);
});

test("resolveCrossfade: 'auto' resolves to a hard cut (false) when reduceMotion is on", () => {
  const ctx = { config: { crossfade: "auto" }, performanceProfile: "full", reduceMotion: true };
  assert.equal(mod.resolveCrossfade.call(ctx), false);
});

test("resolveCrossfade: 'auto' resolves to true on a full profile with reduceMotion off", () => {
  const ctx = { config: { crossfade: "auto" }, performanceProfile: "full", reduceMotion: false };
  assert.equal(mod.resolveCrossfade.call(ctx), true);
});

test("resolveCrossfade: config true forces crossfade on even on a pi profile", () => {
  const ctx = { config: { crossfade: true }, performanceProfile: "pi", reduceMotion: false };
  assert.equal(mod.resolveCrossfade.call(ctx), true);
});

test("resolveCrossfade: config false forces a hard cut even on a full profile", () => {
  const ctx = { config: { crossfade: false }, performanceProfile: "full", reduceMotion: false };
  assert.equal(mod.resolveCrossfade.call(ctx), false);
});

// ---------------------------------------------------------------------------
// Layer alternation: a scene change crossfades into the *other* layer
// ---------------------------------------------------------------------------

test("applySprite: a scene change loads the new sprite into the inactive layer and starts a fade", () => {
  const ctx = makeCtx();
  seedInitialScene(ctx);
  assert.equal(ctx.activeLayer, 0);
  assert.equal(ctx.videoEls[0].classList.contains("is-visible"), true);

  ctx.scene = "rain";
  ctx.spriteUrl = "videos/rain-day.mp4";
  mod.applySprite.call(ctx);

  // The new sprite went onto layer 1 (the previously-inactive layer), and it
  // is now the logically-active layer.
  assert.equal(ctx.activeLayer, 1);
  assert.equal(ctx.videoEls[1].src, "http://localhost/videos/rain-day.mp4");
  assert.ok(ctx.fade, "a fade should be in progress");
  assert.equal(ctx.fade.toEl, ctx.videoEls[1]);
  assert.equal(ctx.fade.fromEl, ctx.videoEls[0]);

  // The old layer 0 must still be showing its frame (fading out), not
  // ripped out mid-fade.
  assert.equal(ctx.videoEls[0].src === "" && ctx.videoEls[0].loadCalls > 0, false);
});

// ---------------------------------------------------------------------------
// Fade completion: once canplay fires and the transition timer elapses, the
// outgoing layer is paused and fully released (src cleared, load() called).
// ---------------------------------------------------------------------------

test("applySprite -> fade completion: the outgoing layer is paused and released after the transition", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });

  const ctx = makeCtx({ config: { ...mod.defaults, transitionSpeed: 500 } });
  seedInitialScene(ctx);
  const outgoing = ctx.videoEls[0];

  ctx.scene = "rain";
  ctx.spriteUrl = "videos/rain-day.mp4";
  mod.applySprite.call(ctx);
  const incoming = ctx.videoEls[1];

  // Simulate the browser telling us the incoming layer can play.
  incoming.oncanplay();

  assert.equal(incoming.classList.contains("is-visible"), true);
  assert.equal(outgoing.classList.contains("is-visible"), false);
  assert.ok(ctx.fade, "fade state persists until the transition timer elapses");

  t.mock.timers.tick(500);

  assert.equal(ctx.fade, null);
  assert.equal(outgoing.pauseCalls > 0, true);
  assert.equal(outgoing.src, "");
  assert.equal(outgoing.loadCalls > 0, true);
  // Only one layer should be left visible/decoding.
  assert.equal(incoming.classList.contains("is-visible"), true);
  assert.equal(outgoing.classList.contains("is-visible"), false);
});

// ---------------------------------------------------------------------------
// Cancellation mid-fade: a third scene arriving before the first fade
// finishes must cancel cleanly, with no stuck half-opacity layer and no two
// videos left decoding.
// ---------------------------------------------------------------------------

test("applySprite: a new scene mid-fade, BEFORE canplay, keeps the still-good outgoing layer visible (no blank)", () => {
  // r4 QA regression: superseding a fade before the incoming layer has
  // decoded a frame must not blank the screen. Nothing on the undecoded
  // layer is worth keeping, so throw *it* away and keep showing the layer
  // that was already on screen.
  const ctx = makeCtx();
  seedInitialScene(ctx); // layer 0 = clear (visible)

  ctx.scene = "rain";
  ctx.spriteUrl = "videos/rain-day.mp4";
  mod.applySprite.call(ctx); // fade: layer0 -> layer1, layer1 not yet "canplay"

  const clearLayer = ctx.videoEls[0];
  const rainLayer = ctx.videoEls[1];
  assert.equal(ctx.fade.toEl, rainLayer);
  assert.equal(ctx.fade.canplayFired, false);

  // A third scene arrives before rainLayer ever fires canplay.
  ctx.scene = "snow";
  ctx.spriteUrl = "videos/cloudy-day.mp4";
  mod.applySprite.call(ctx);

  // clearLayer (the layer that was actually decoded and on screen) must
  // stay exactly as it was - still visible, src untouched - never blanked.
  assert.equal(clearLayer.classList.contains("is-visible"), true);
  assert.equal(clearLayer.src, "http://localhost/videos/clear-day.mp4");

  // rainLayer (never decoded a frame) is thrown away instead of promoted.
  assert.equal(rainLayer.classList.contains("is-visible"), false);
  assert.equal(rainLayer.loadCalls > 0, true);

  // A brand-new fade now targets the freed layer (rainLayer, reused and
  // loaded with the snow sprite), fading from clearLayer.
  assert.equal(ctx.fade.fromEl, clearLayer);
  assert.equal(ctx.fade.toEl, rainLayer);
  assert.equal(rainLayer.src, "http://localhost/videos/cloudy-day.mp4");
  assert.equal(ctx.activeLayer, 1);

  // Never more than the two physical layers; nothing left half-opacity.
  assert.equal(ctx.videoEls.length, 2);
});

test("applySprite: a new scene mid-fade, AFTER canplay, still promotes the already-decoded incoming layer", () => {
  const ctx = makeCtx();
  seedInitialScene(ctx); // layer 0 = clear (visible)

  ctx.scene = "rain";
  ctx.spriteUrl = "videos/rain-day.mp4";
  mod.applySprite.call(ctx);

  const clearLayer = ctx.videoEls[0];
  const rainLayer = ctx.videoEls[1];

  // rainLayer has already decoded a frame and started fading in.
  rainLayer.oncanplay();
  assert.equal(ctx.fade.canplayFired, true);

  ctx.scene = "snow";
  ctx.spriteUrl = "videos/cloudy-day.mp4";
  mod.applySprite.call(ctx);

  // rainLayer had real decoded content - it's promoted rather than thrown
  // away, and clearLayer (now stale) is released.
  assert.equal(rainLayer.classList.contains("is-visible"), true);
  assert.equal(clearLayer.classList.contains("is-visible"), false);
  assert.equal(clearLayer.loadCalls > 0, true);

  assert.equal(ctx.fade.fromEl, rainLayer);
  assert.equal(ctx.fade.toEl, clearLayer);
  assert.equal(clearLayer.src, "http://localhost/videos/cloudy-day.mp4");
  assert.equal(ctx.activeLayer, 0);
});

// ---------------------------------------------------------------------------
// Same scene requested again: no-op, no fade started.
// ---------------------------------------------------------------------------

test("updateSprite: requesting the same scene again is a no-op (no fade, no reload)", () => {
  const ctx = makeCtx();

  mod.updateSprite.call(ctx, "clear", false, { url: "videos/clear-day.mp4", type: "video", playbackRate: 1 });
  const loadCallsLayer0 = ctx.videoEls[0].loadCalls;
  const loadCallsLayer1 = ctx.videoEls[1].loadCalls;
  assert.equal(ctx.fade, null);

  mod.updateSprite.call(ctx, "clear", false, { url: "videos/clear-day.mp4", type: "video", playbackRate: 1 });

  // Nothing reloaded and no fade was started for a repeat of the same scene.
  assert.equal(ctx.fade, null);
  assert.equal(ctx.videoEls[0].loadCalls, loadCallsLayer0);
  assert.equal(ctx.videoEls[1].loadCalls, loadCallsLayer1);
});

// ---------------------------------------------------------------------------
// Error fallback during a fade: the incoming (bad) layer errors mid-fade -
// fall back to the still-good outgoing layer, then crossfade to default.
// ---------------------------------------------------------------------------

test("handleLayerError: an error on the incoming layer during a fade drops back to the still-good outgoing layer before falling back to default", () => {
  const ctx = makeCtx();

  seedInitialScene(ctx); // layer 0 = clear (visible, good)

  ctx.scene = "rain";
  ctx.spriteUrl = "videos/rain-day.mp4";
  mod.applySprite.call(ctx);

  const goodLayer = ctx.videoEls[0];
  const badLayer = ctx.videoEls[1];
  assert.equal(ctx.fade.toEl, badLayer);
  const pauseCallsBefore = badLayer.pauseCalls;

  badLayer.error = { message: "decode failure" };
  mod.handleLayerError.call(ctx, badLayer);

  // The failed layer must have been released (paused, src cleared, load()
  // called to abort the bad decode) as its very first act of cleanup, before
  // anything else (including a new fallback fade) touches it again.
  assert.equal(badLayer.pauseCalls > pauseCallsBefore, true);

  // A fallback to "default" was requested and applied.
  assert.equal(ctx.scene, "default");

  // No stuck state: exactly one of two outcomes holds - either the fallback
  // is a genuinely new scene, in which case it crossfades in on the
  // now-freed (former bad) layer while the still-good layer keeps showing
  // its last frame until that completes, or the fallback matched what's
  // already on screen and nothing further changed. Either way there must
  // never be two layers claiming "is-visible" and the fade state must be
  // internally consistent (both null, or a real fromEl/toEl pair).
  const visibleCount = ctx.videoEls.filter((el) => el.classList.contains("is-visible")).length;
  assert.equal(visibleCount <= 1, true);
  if (ctx.fade) {
    assert.equal(ctx.fade.fromEl, goodLayer);
    assert.notEqual(ctx.fade.toEl, undefined);
  }
  assert.equal(goodLayer.classList.contains("is-visible"), true);
});

// ---------------------------------------------------------------------------
// r4 QA regression: autoplay must never be set unconditionally while the
// module is suspended - not on the hard-cut path (the Pi default) and not
// on the crossfade path either.
// ---------------------------------------------------------------------------

test("loadIntoLayer: never sets autoplay while suspended (hard-cut / Pi default path)", () => {
  const ctx = makeCtx({ suspended: true });
  const el = ctx.videoEls[0];

  mod.loadIntoLayer.call(ctx, el, "http://localhost/videos/rain-day.mp4", false);

  assert.equal(el.autoplay, false);
  assert.equal(el.playCalls, 0);
});

test("loadIntoLayer: autoplay is allowed again once not suspended", () => {
  const ctx = makeCtx({ suspended: false });
  const el = ctx.videoEls[0];

  mod.loadIntoLayer.call(ctx, el, "http://localhost/videos/rain-day.mp4", true);

  assert.equal(el.autoplay, true);
});

test("startCrossfade: never sets autoplay on the incoming layer while suspended", () => {
  const ctx = makeCtx();
  seedInitialScene(ctx);

  ctx.suspended = true;
  ctx.scene = "rain";
  ctx.spriteUrl = "videos/rain-day.mp4";
  mod.applySprite.call(ctx);

  assert.ok(ctx.fade, "a crossfade should still be started while suspended (it just must not play)");
  assert.equal(ctx.fade.toEl.autoplay, false);
  assert.equal(ctx.fade.toEl.playCalls, 0);
});

// ---------------------------------------------------------------------------
// r4 QA regression: handleLayerError must capture the failing element's own
// src (not this.spriteUrl, which may already point at a newer target) and
// must only fall back to "default" when the failed layer is the active
// layer or the fade's incoming layer - not when it's the outgoing layer of
// a fade that's already superseding it.
// ---------------------------------------------------------------------------

test("handleLayerError: an error on the outgoing layer (fade.fromEl) just releases it and doesn't touch the incoming fade", () => {
  const ctx = makeCtx();
  seedInitialScene(ctx);

  ctx.scene = "rain";
  ctx.spriteUrl = "videos/rain-day.mp4";
  mod.applySprite.call(ctx);

  const clearLayer = ctx.videoEls[0]; // fade.fromEl - still visible, fading out
  const rainLayer = ctx.videoEls[1]; // fade.toEl - fading in
  assert.equal(ctx.fade.fromEl, clearLayer);

  const sceneBefore = ctx.scene;
  const activeLayerBefore = ctx.activeLayer;

  clearLayer.error = { message: "decode failure" };
  mod.handleLayerError.call(ctx, clearLayer);

  // Released, not left decoding.
  assert.equal(clearLayer.pauseCalls > 0, true);
  assert.equal(clearLayer.src, "");

  // The fade bringing rain in must be completely untouched - no fallback to
  // "default" was triggered by an error on the layer that was already on
  // its way out.
  assert.equal(ctx.scene, sceneBefore);
  assert.equal(ctx.activeLayer, activeLayerBefore);
  assert.ok(ctx.fade, "the incoming fade should still be in progress");
  assert.equal(ctx.fade.toEl, rainLayer);
});

test("handleLayerError: logs the failed element's own src, not the current spriteUrl target", () => {
  const logs = [];
  const originalError = Log.error;
  Log.error = (msg) => logs.push(msg);

  try {
    const ctx = makeCtx();
    seedInitialScene(ctx);

    ctx.scene = "rain";
    ctx.spriteUrl = "videos/rain-day.mp4";
    mod.applySprite.call(ctx);

    const rainLayer = ctx.videoEls[1];
    rainLayer.error = { message: "404" };
    mod.handleLayerError.call(ctx, rainLayer);

    assert.equal(logs.length, 1);
    assert.match(logs[0], /rain-day\.mp4/);
    assert.doesNotMatch(logs[0], /clear-day\.mp4/);
  } finally {
    Log.error = originalError;
  }
});
