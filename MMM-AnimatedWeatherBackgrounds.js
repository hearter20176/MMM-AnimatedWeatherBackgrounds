/* MMM-AnimatedWeatherBackgrounds
 * Renders full-screen animated weather backdrops from looping videos.
 * Listens to the core weather module (CURRENTWEATHER_TYPE / WEATHER_UPDATED).
 */

Module.register("MMM-AnimatedWeatherBackgrounds", {
  // ---------------------------------------------------------------------------
  // Defaults
  // ---------------------------------------------------------------------------
  defaults: {
    opacity: 0.7,
    blur: "1.5px",
    vignette: 0.32,
    videoPlaybackRate: 1,
    transitionSpeed: 800,
    // Pi performance controls. performanceProfile: "auto" (detect from user agent),
    // "pi" (force low-cost rendering) or "full" (force everything on).
    performanceProfile: "auto",
    reduceMotion: false,
    // Crossfade between scenes using two stacked <video> layers. "auto" (default)
    // crossfades unless performanceProfile resolves to "pi" or reduceMotion is on,
    // in which case it falls back to a hard cut. true/false force it either way.
    crossfade: "auto",
    // Pause the <video> while this module's region is suspended/hidden.
    pauseWhileHidden: true,
    // Fade duration (ms) used when this module is hidden/shown (e.g. a page-scoped
    // module under MMM-pages). Replaces the speed MagicMirror passes to hide()/show(),
    // which is much shorter than a fullscreen video wants. 0 = use MagicMirror's speed.
    // Ignored (instant) when reduceMotion is on.
    pageFadeDuration: 1500,
    spriteSheets: {
      clear: { day: "videos/clear-day.mp4", night: "videos/clear-night.mp4" },
      partly_cloudy: {
        day: "videos/partly-cloudy-day.mp4",
        night: "videos/partly-cloudy-night.mp4"
      },
      cloudy: { day: "videos/cloudy-day.mp4", night: "videos/cloudy-night.mp4" },
      rain: { day: "videos/rain-day.mp4", night: "videos/rain-night.mp4" },
      sleet: { day: "videos/sleet-day.mp4", night: "videos/rain-night.mp4" },
      thunderstorm: { day: "videos/rain-day.mp4", night: "videos/rain-night.mp4" },
      snow: { day: "videos/cloudy-day.mp4", night: "videos/cloudy-night.mp4" },
      fog: { day: "videos/cloudy-day.mp4", night: "videos/cloudy-night.mp4" },
      wind: { day: "videos/cloudy-day.mp4", night: "videos/cloudy-night.mp4" },
      default: { day: "videos/clear-day.mp4", night: "videos/clear-night.mp4" }
    }
  },

  // ---------------------------------------------------------------------------
  // Assets
  // ---------------------------------------------------------------------------
  getStyles() {
    return ["MMM-AnimatedWeatherBackgrounds.css"];
  },

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------
  start() {
    Log.info(`Starting module: ${this.name}`);

    this.scene = null;
    this.isNight = false;
    this.lastIsNightHint = null;
    this.sunTimes = { sunrise: null, sunset: null };
    this.manualOverride = null;
    this.rootEl = null;
    this.spriteMeta = { type: "video", playbackRate: this.config.videoPlaybackRate || 1 };
    this.spriteUrl = null;
    // Two stacked <video> layers so scene changes can crossfade instead of hard-cutting.
    // Only one is ever playing/decoding at steady state; see applySprite/startCrossfade.
    this.videoEls = null;
    this.activeLayer = 0;
    this.fade = null;
    this.suspended = false;

    this.performanceProfile = this.resolvePerformanceProfile();
    // reduceMotion is opt-in via config; the "pi" profile on its own only
    // trims blur cost (see getDom), it does not force still frames.
    this.reduceMotion = this.config.reduceMotion === true;
    this.crossfade = this.resolveCrossfade();

    // Seed the page theme from body classes (set by MMM-GlassClock) before the
    // first PAGE_THEME_CHANGED notification arrives.
    this.pageNight = null;
    if (typeof document !== "undefined" && document.body) {
      if (document.body.classList.contains("mm-night")) this.pageNight = true;
      else if (document.body.classList.contains("mm-day")) this.pageNight = false;
    }

    // Set an initial backdrop so something renders before weather notifications land.
    this.applyScene("default", this.resolveNightFlag(null));
  },

  // ---------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------
  getDom() {
    if (this.rootEl) {
      // Reuse existing DOM to avoid unnecessary video reloads during other module animations.
      const activeEl = this.videoEls && this.videoEls[this.activeLayer];
      if (
        activeEl &&
        this.spriteUrl &&
        activeEl.paused &&
        !this.suspended &&
        !this.reduceMotion &&
        !this.fade
      ) {
        activeEl.play().catch((err) => {
          Log.warn(`[${this.name}] Video resume failed: ${err?.message || err}`);
        });
      }
      return this.rootEl;
    }

    const root = document.createElement("div");
    root.className = "mmm-awb";
    root.style.setProperty("--awb-opacity", this.config.opacity);
    root.style.setProperty("--awb-blur", this.performanceProfile === "pi" ? "0px" : this.config.blur);
    root.style.setProperty("--awb-vignette", this.config.vignette);

    const layerA = this.createVideoLayer();
    const layerB = this.createVideoLayer();

    const tint = document.createElement("div");
    tint.className = "mmm-awb__tint";

    root.appendChild(layerA);
    root.appendChild(layerB);
    root.appendChild(tint);

    this.rootEl = root;
    this.videoEls = [layerA, layerB];
    this.activeLayer = 0;
    this.fade = null;
    this.applySprite();

    return root;
  },

  createVideoLayer() {
    const video = document.createElement("video");
    video.className = "mmm-awb__video";
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.autoplay = !this.reduceMotion && !this.suspended;
    video.setAttribute("preload", "auto");
    video.addEventListener("error", () => this.handleLayerError(video));
    return video;
  },

  // ---------------------------------------------------------------------------
  // Notifications
  // ---------------------------------------------------------------------------
  notificationReceived(notification, payload, sender) {
    if (notification === "CURRENTWEATHER_TYPE") {
      this.handleWeatherType(payload?.type);
    } else if (notification === "WEATHER_UPDATED") {
      this.handleWeatherUpdate(payload);
    } else if (notification === "AMBIENT_WEATHER_DATA") {
      this.handleAmbientWeather(payload);
    } else if (notification === "PAGE_THEME_CHANGED") {
      this.handlePageThemeChanged(payload);
    } else if (notification === "ANIMATED_WEATHER_BACKGROUND_SET") {
      this.handleManualSet(payload);
    } else if (notification === "ANIMATED_WEATHER_BACKGROUND_CLEAR") {
      this.manualOverride = null;
      if (this.scene) {
        this.applyScene(this.scene, this.resolveNightFlag(this.lastIsNightHint));
      }
    }
  },

  handlePageThemeChanged(payload) {
    if (!payload || (payload.mode !== "day" && payload.mode !== "night")) return;
    this.pageNight = payload.mode === "night";

    // Only re-derive night from the page theme when nothing more specific
    // (explicit weather hint or sun times) is already driving it.
    if (this.scene && this.lastIsNightHint === null && !(this.sunTimes.sunrise && this.sunTimes.sunset)) {
      this.applyScene(this.scene, this.resolveNightFlag(null));
    }
  },

  handleAmbientWeather(payload) {
    if (!payload) return;

    this.sunTimes = {
      sunrise: this.parseTimestamp(payload.sunrise),
      sunset: this.parseTimestamp(payload.sunset)
    };

    // MMM-AmbientWeather defaults isDaytime to true when it has no lat/long to
    // compute real sun times (its node_helper can't tell day from night then).
    // Only trust isDaytime when it comes with the sunrise/sunset pair that
    // backs it; otherwise fall through to sunTimes/page-theme/local-time below.
    const isNightHint =
      typeof payload.isDaytime === "boolean" && payload.sunrise && payload.sunset
        ? !payload.isDaytime
        : null;
    this.lastIsNightHint = isNightHint;
    const isNight = this.resolveNightFlag(isNightHint);

    const type =
      payload.condition ||
      payload.conditionCode ||
      payload.icon ||
      payload.weather ||
      null;

    if (type || this.manualOverride) {
      if (this.manualOverride) {
        this.applyManualOverride();
        return;
      }
      const normalized = this.normalizeWeather(type);
      this.applyScene(normalized.scene, isNight);
    }
  },

  handleWeatherUpdate(payload) {
    if (!payload || !payload.currentWeather) return;

    const cw = payload.currentWeather;
    this.sunTimes = {
      sunrise: this.parseTimestamp(cw.sunrise),
      sunset: this.parseTimestamp(cw.sunset)
    };

    if (cw.weatherType) {
      this.handleWeatherType(cw.weatherType);
    }
  },

  handleWeatherType(type) {
    if (!type && !this.manualOverride) return;

    if (this.manualOverride) {
      this.applyManualOverride();
      return;
    }

    const normalized = this.normalizeWeather(type);
    this.lastIsNightHint = normalized.isNightHint;
    const isNight = this.resolveNightFlag(normalized.isNightHint);
    const sceneKey = normalized.scene;
    this.applyScene(sceneKey, isNight);
  },

  handleManualSet(payload) {
    if (!payload || (!payload.scene && !payload.spriteUrl)) return;
    this.manualOverride = {
      scene: payload.scene || null,
      spriteUrl: payload.spriteUrl || null,
      isNight: typeof payload.isNight === "boolean" ? payload.isNight : null,
      playbackRate: payload.playbackRate || this.config.videoPlaybackRate || 1
    };
    this.applyManualOverride();
  },

  applyManualOverride() {
    const override = this.manualOverride;
    if (!override) return;

    const sceneKey = override.scene || "manual";
    const isNight =
      typeof override.isNight === "boolean" ? override.isNight : this.resolveNightFlag(null);

    if (override.spriteUrl) {
      this.updateSprite(sceneKey, isNight, {
        url: this.resolveSpriteUrl(override.spriteUrl),
        playbackRate: override.playbackRate || this.config.videoPlaybackRate || 1
      });
      return;
    }

    this.applyScene(sceneKey, isNight);
  },

  // ---------------------------------------------------------------------------
  // Scene + media helpers
  // ---------------------------------------------------------------------------
  applyScene(sceneKey, isNight) {
    const spriteInfo = this.lookupSprite(sceneKey, isNight);
    this.updateSprite(sceneKey, isNight, spriteInfo);
  },

  lookupSprite(sceneKey, isNight) {
    const sprites = this.config.spriteSheets || {};
    const sceneConfig = sprites[sceneKey] || sprites.default || {};

    const normalized = this.normalizeSpriteConfig(sceneConfig);
    const url = isNight ? normalized.night : normalized.day;
    const fallbackUrl = isNight ? normalized.day : normalized.night;
    let spriteUrl = this.resolveSpriteUrl(url || fallbackUrl);

    if (!this.isVideoUrl(spriteUrl)) {
      const defaultCfg = this.normalizeSpriteConfig(sprites.default || {});
      const defaultPrimary = isNight ? defaultCfg.night : defaultCfg.day;
      const defaultSecondary = isNight ? defaultCfg.day : defaultCfg.night;
      const defaultUrl = this.resolveSpriteUrl(defaultPrimary || defaultSecondary);
      spriteUrl = this.isVideoUrl(defaultUrl) ? defaultUrl : null;
      Log.warn(
        `[${this.name}] Non-video media configured for scene "${sceneKey}" (${isNight ? "night" : "day"}).` +
          ` Falling back to default video: ${spriteUrl || "none"}`
      );
    }

    return {
      url: spriteUrl,
      type: "video",
      playbackRate: normalized.playbackRate || this.config.videoPlaybackRate || 1
    };
  },

  normalizeSpriteConfig(entry) {
    if (typeof entry === "string") {
      return { day: entry, night: entry };
    }
    return entry || {};
  },

  updateSprite(sceneKey, isNight, spriteInfo) {
    if (!spriteInfo || !spriteInfo.url) {
      Log.warn(`[${this.name}] No media found for scene "${sceneKey}".`);
      return;
    }

    const nextType = spriteInfo.type || (this.isVideoUrl(spriteInfo.url) ? "video" : "image");
    const nextPlayback = spriteInfo.playbackRate || this.config.videoPlaybackRate || 1;
    const nextSignature = `${sceneKey}:${isNight ? "night" : "day"}:${spriteInfo.url}:${nextPlayback}`;
    const isSameScene =
      this.scene === sceneKey &&
      this.isNight === isNight &&
      this.spriteUrl === spriteInfo.url &&
      this.spriteMeta?.type === nextType &&
      this.spriteMeta?.playbackRate === nextPlayback;

    if (isSameScene) {
      // Avoid unnecessary reloads when nothing changed (prevents flicker when other modules animate).
      const activeEl = this.videoEls && this.videoEls[this.activeLayer];
      if (activeEl && activeEl.paused && !this.suspended && !this.reduceMotion && !this.fade) {
        activeEl.play().catch((err) => {
          Log.warn(`[${this.name}] Video resume failed: ${err?.message || err}`);
        });
      }
      return;
    }

    this.scene = sceneKey;
    this.isNight = isNight;
    this.spriteUrl = spriteInfo.url;
    this.spriteMeta = {
      type: nextType,
      playbackRate: nextPlayback
    };
    this.lastSceneSignature = nextSignature;

    Log.info(`[${this.name}] Applying scene "${sceneKey}" (${isNight ? "night" : "day"}) -> ${this.spriteUrl}`);

    this.applySprite();
  },

  // ---------------------------------------------------------------------------
  // Rendering: two-layer crossfade
  // ---------------------------------------------------------------------------
  applySprite() {
    // Called once from start() before the DOM exists (no-op then) and again
    // from getDom()/updateSprite() once the two <video> layers are live.
    if (!this.videoEls || this.videoEls.length < 2) return;

    const isVideo = this.spriteMeta.type === "video";

    if (!isVideo || !this.spriteUrl) {
      this.cancelFade();
      this.videoEls.forEach((el) => {
        el.pause();
        el.classList.remove("is-visible");
      });
      if (!isVideo && this.spriteUrl) {
        Log.warn(`[${this.name}] Non-video media is not supported after sprite removal. Given url: ${this.spriteUrl}`);
      }
      return;
    }

    const absoluteUrl = new URL(this.spriteUrl, window.location.origin).href;

    // Resolve any fade already in progress first, so the layer bookkeeping
    // below reflects a single settled "current" layer - not a half-applied
    // fade - before deciding where the new sprite goes. cancelFade() is a
    // no-op when nothing is fading.
    this.cancelFade();

    const activeEl = this.videoEls[this.activeLayer];
    const inactiveIndex = this.activeLayer === 0 ? 1 : 0;
    const inactiveEl = this.videoEls[inactiveIndex];

    const activeShowingUrl = activeEl.currentSrc === absoluteUrl || activeEl.src === absoluteUrl;
    const activeHasContent = activeEl.classList.contains("is-visible");

    if (activeShowingUrl && activeHasContent) {
      // Nothing to do - the visible layer already has this sprite.
      return;
    }

    // Crossfade only makes sense when something is already on screen; the very
    // first load (or a recovery from a fully-cleared state) is a direct load.
    if (this.crossfade && activeHasContent) {
      this.startCrossfade(inactiveEl, activeEl, absoluteUrl);
    } else {
      this.loadIntoLayer(activeEl, absoluteUrl, !this.suspended);
      this.releaseLayer(inactiveEl);
    }
  },

  // Direct (hard-cut) load into a single layer: used for the first-ever load
  // and whenever crossfade is disabled/unavailable.
  loadIntoLayer(el, absoluteUrl, playImmediately) {
    const alreadyThere = el.currentSrc === absoluteUrl || el.src === absoluteUrl;

    el.muted = true;
    el.playsInline = true;
    el.loop = true;
    el.playbackRate = this.spriteMeta.playbackRate || 1;
    el.style.transitionDuration = `${this.config.transitionSpeed}ms`;

    if (!alreadyThere) {
      el.src = absoluteUrl;
      el.load();
    }
    el.classList.add("is-visible");

    if (this.reduceMotion) {
      // Show the first frame only; never decode a running video. autoplay is
      // off and play() is never called, so there's no need to seek back to
      // currentTime 0 - doing that would re-trigger "canplay" in Chromium and
      // loop forever. Clear the handler before it runs so a second canplay
      // (which can still fire, e.g. after a source change) is a no-op.
      el.autoplay = false;
      el.oncanplay = () => {
        el.oncanplay = null;
        el.pause();
      };
    } else {
      // Never autoplay unconditionally - if this load is happening while the
      // module is suspended (e.g. a hidden MMM-pages page), the browser must
      // not start decoding/playing on its own. play() is only ever called
      // explicitly below/in oncanplay, both of which already check suspended.
      el.autoplay = !this.suspended;
      el.oncanplay = () => {
        el.oncanplay = null;
        if (this.suspended) return;
        el.play().catch((err) => {
          Log.warn(`[${this.name}] Video playback failed: ${err?.message || err}`);
        });
      };
      if (playImmediately) {
        el.play().catch((err) => {
          Log.warn(`[${this.name}] Video playback failed: ${err?.message || err}`);
        });
      }
    }
  },

  // Crossfade: load the new sprite into `incomingEl` (currently the inactive
  // layer) and, once it can play, fade it in while fading `outgoingEl` out.
  // The outgoing layer is paused and released only after the fade completes.
  startCrossfade(incomingEl, outgoingEl, absoluteUrl) {
    // Any fade already in progress is superseded - resolve it instantly onto
    // its (still-current) target layer before starting the new one, so we
    // never end up with two videos decoding or a layer stuck mid-opacity.
    this.cancelFade();

    const incomingIndex = this.videoEls.indexOf(incomingEl);

    incomingEl.pause();
    incomingEl.classList.remove("is-visible");
    incomingEl.muted = true;
    incomingEl.playsInline = true;
    incomingEl.loop = true;
    incomingEl.playbackRate = this.spriteMeta.playbackRate || 1;
    incomingEl.style.transitionDuration = `${this.config.transitionSpeed}ms`;
    outgoingEl.style.transitionDuration = `${this.config.transitionSpeed}ms`;
    // Never autoplay unconditionally - see the matching comment in loadIntoLayer.
    incomingEl.autoplay = !this.reduceMotion && !this.suspended;
    incomingEl.src = absoluteUrl;
    incomingEl.load();

    this.activeLayer = incomingIndex;

    const fadeState = { fromEl: outgoingEl, toEl: incomingEl, timeoutId: null, canplayFired: false };
    this.fade = fadeState;

    incomingEl.oncanplay = () => {
      incomingEl.oncanplay = null;
      // Cancelled/superseded before this fired - do nothing.
      if (this.fade !== fadeState) return;
      fadeState.canplayFired = true;

      if (this.reduceMotion) {
        incomingEl.pause();
      } else if (!this.suspended) {
        incomingEl.play().catch((err) => {
          Log.warn(`[${this.name}] Video playback failed: ${err?.message || err}`);
        });
      }

      incomingEl.classList.add("is-visible");
      outgoingEl.classList.remove("is-visible");

      fadeState.timeoutId = setTimeout(() => {
        if (this.fade !== fadeState) return;
        this.releaseLayer(outgoingEl);
        this.fade = null;
      }, this.config.transitionSpeed);
    };
  },

  // Cancel any in-progress fade. Safe to call when no fade is running.
  //
  // If the incoming layer has already reached canplay (it has a decoded
  // frame to show), promote it to fully visible - it was already becoming
  // the current scene - and release the layer that was fading out.
  //
  // If it hasn't decoded anything yet, promoting it would blank the screen
  // for however long the next load takes (r4 QA: 150-250ms with rapid scene
  // changes at startup). There's nothing worth keeping on that layer, so
  // release *it* instead and keep showing the still-good outgoing layer.
  cancelFade() {
    if (!this.fade) return;

    const { fromEl, toEl, timeoutId, canplayFired } = this.fade;
    if (timeoutId) clearTimeout(timeoutId);

    if (canplayFired) {
      toEl.oncanplay = null;
      toEl.classList.add("is-visible");
      fromEl.classList.remove("is-visible");
      this.releaseLayer(fromEl);

      if (this.reduceMotion) {
        toEl.pause();
      } else if (!this.suspended) {
        toEl.play().catch((err) => {
          Log.warn(`[${this.name}] Video playback failed: ${err?.message || err}`);
        });
      }
    } else {
      // Nothing decoded on toEl yet - throw it away and keep fromEl as the
      // active/visible layer exactly as it was.
      this.releaseLayer(toEl);
      this.activeLayer = this.videoEls.indexOf(fromEl);
    }

    this.fade = null;
  },

  // Pause + fully unload a layer so only one video decodes at steady state.
  releaseLayer(el) {
    if (!el) return;
    el.oncanplay = null;
    el.pause();
    el.classList.remove("is-visible");
    el.removeAttribute("src");
    el.load();
  },

  handleLayerError(el) {
    // Capture what actually failed before releaseLayer() clears it - logging
    // this.spriteUrl here would name whatever the *next* target is, not the
    // file that errored (they differ whenever this layer was superseded
    // before it failed).
    const failedSrc = (el.getAttribute && el.getAttribute("src")) || el.src || "(unknown)";
    const detail = el.error ? el.error.message || el.error.code : "unknown error";
    Log.error(`[${this.name}] Failed to load video ${failedSrc}: ${detail}`);

    const isFadeToEl = this.fade && this.fade.toEl === el;
    const isActiveLayer = this.videoEls && this.videoEls[this.activeLayer] === el;

    if (isFadeToEl) {
      // Failed mid-fade: drop back to the still-good outgoing layer instead
      // of hard-cutting away from valid content.
      const outgoingEl = this.fade.fromEl;
      if (this.fade.timeoutId) clearTimeout(this.fade.timeoutId);
      this.fade = null;
      this.releaseLayer(el);
      this.activeLayer = this.videoEls.indexOf(outgoingEl);
    } else {
      // Either the outgoing side of a fade (already being superseded - it
      // has nothing left to contribute, just let it go) or a plain hard-cut
      // failure. Either way, just release it.
      this.releaseLayer(el);
    }

    if (!isActiveLayer && !isFadeToEl) {
      // This layer wasn't the one driving the current or incoming scene
      // (e.g. the outgoing half of a fade that had already been
      // superseded) - nothing valid was lost, so don't stomp whatever scene
      // is still on screen or fading in.
      return;
    }

    const fallback = this.lookupSprite("default", this.isNight);
    if (fallback.url && fallback.url !== this.spriteUrl) {
      this.updateSprite("default", this.isNight, fallback);
    }
  },

  normalizeWeather(type) {
    const raw = (type || "").toLowerCase();
    const isNightHint = raw.includes("night") ? true : raw.includes("day") ? false : null;
    const isThunder = /thunder|storm/.test(raw);
    const isSnow = /snow/.test(raw);
    const isSleet = /sleet|hail/.test(raw);
    const isRain = /rain|shower|drizzle|sprinkle/.test(raw);
    const isFog = /fog|haze|mist/.test(raw);
    const isWind = /wind|breeze|tornado|hurricane/.test(raw);
    const isCloud = /cloud|overcast/.test(raw);
    const isPartly = /partly|sunny[-_\s]?overcast|broken/.test(raw);

    let scene = "clear";
    if (isThunder) {
      scene = "thunderstorm";
    } else if (isSnow) {
      scene = "snow";
    } else if (isSleet) {
      scene = "sleet";
    } else if (isRain) {
      scene = "rain";
    } else if (isFog) {
      scene = "fog";
    } else if (isWind) {
      scene = "wind";
    } else if (isCloud) {
      scene = isPartly ? "partly_cloudy" : "cloudy";
    }

    return { scene, isNightHint, raw };
  },

  resolveNightFlag(isNightHint) {
    if (typeof isNightHint === "boolean") return isNightHint;

    const now = Date.now();
    const { sunrise, sunset } = this.sunTimes;
    if (sunrise && sunset) {
      return now < sunrise || now > sunset;
    }

    // Fall back to the page theme (set by MMM-GlassClock from real sun times)
    // before resorting to a raw local-time guess.
    if (typeof this.pageNight === "boolean") return this.pageNight;

    const hour = new Date().getHours();
    return hour < 6 || hour >= 19;
  },

  parseTimestamp(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "number") return value;
    if (value instanceof Date) return value.getTime();
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? null : parsed;
    }
    if (typeof value.valueOf === "function") {
      const val = value.valueOf();
      if (typeof val === "number" && !Number.isNaN(val)) return val;
    }
    return null;
  },

  resolveSpriteUrl(path) {
    if (!path) return null;
    if (/^https?:\/\//i.test(path) || path.startsWith("data:") || path.startsWith("/")) {
      return path;
    }
    // If user provided an absolute module path (modules/MMM-AnimatedWeatherBackgrounds/...), avoid double-prefixing.
    if (/^modules\//i.test(path)) {
      return `/${path.replace(/^\/?/, "")}`;
    }
    return this.file(path);
  },

  isVideoUrl(path) {
    if (!path) return false;
    return /\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(path);
  },

  resolvePerformanceProfile() {
    const requested = (this.config.performanceProfile || "auto").toLowerCase();
    if (requested === "pi" || requested === "full") return requested;
    const ua = (
      typeof navigator !== "undefined" && navigator.userAgent ? navigator.userAgent : ""
    ).toLowerCase();
    const isPi =
      ua.includes("raspberry") ||
      ua.includes("armv7") ||
      ua.includes("aarch64") ||
      ua.includes("linux arm");
    return isPi ? "pi" : "full";
  },

  resolveCrossfade() {
    const requested = this.config.crossfade;
    if (requested === true) return true;
    if (requested === false) return false;
    // "auto": crossfade unless doing so would cost more than a Pi (or a user
    // who asked for reduced motion) should pay.
    if (this.reduceMotion) return false;
    if (this.performanceProfile === "pi") return false;
    return true;
  },

  // MagicMirror's module.hide()/show() fade the module wrapper at the speed the caller
  // asks for (MMM-pages: 500 ms), then call suspend() after a hide completes and
  // resume() only after a show completes. Overriding both lets us (1) stretch the
  // wrapper fade to pageFadeDuration so the fullscreen video doesn't cut, which also
  // delays suspend() until the fade-out has finished, and (2) start playback at the
  // start of a show so the video is already moving while it fades in.
  hide(speed, callback, options) {
    this._super(this.resolveFadeSpeed(speed), callback, options);
  },

  show(speed, callback, options) {
    this._super(this.resolveFadeSpeed(speed), callback, options);
    // MM clears module.hidden only when the show is actually accepted (a lockString
    // can refuse it), so only start playing in that case.
    if (this.hidden === false) this.startPlayback();
  },

  resolveFadeSpeed(speed) {
    if (this.reduceMotion) return 0;
    // A zero/invalid speed means "no animation" (e.g. an initial hide): keep it.
    if (!(speed > 0)) return speed;
    const duration = Number(this.config.pageFadeDuration);
    return duration > 0 ? duration : speed;
  },

  suspend() {
    // A show can interrupt a hide; MM cancels the hide timer in that case, but be
    // defensive so a stray suspend never pauses a module that is on screen.
    if (this.hidden === false) return;
    this.suspended = true;
    if (!this.config.pauseWhileHidden || !this.videoEls) return;
    this.videoEls.forEach((el) => el.pause());
  },

  resume() {
    this.startPlayback();
  },

  // Shared by show() (start of fade-in) and resume() (end of fade-in); idempotent.
  startPlayback() {
    this.suspended = false;
    if (!this.config.pauseWhileHidden || !this.videoEls || this.reduceMotion) return;

    // Resume whichever layer(s) should be visibly playing: just the active
    // layer normally, or both sides of an in-progress fade. play() continues from
    // the current position; the source is never reloaded here.
    const layers = this.fade ? [this.fade.fromEl, this.fade.toEl] : [this.videoEls[this.activeLayer]];
    layers.forEach((el) => {
      if (el && el.paused && el.classList.contains("is-visible")) {
        el.play().catch((err) => {
          Log.warn(`[${this.name}] Video resume failed: ${err?.message || err}`);
        });
      }
    });
  }
});
