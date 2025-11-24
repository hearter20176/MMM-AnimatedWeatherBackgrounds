/* MMM-AnimatedWeatherBackgrounds
 * Renders full-screen animated weather backdrops from looping videos.
 * Listens to the core weather module (CURRENTWEATHER_TYPE / WEATHER_UPDATED).
 */

/* global Module, Log */

Module.register("MMM-AnimatedWeatherBackgrounds", {
  // ---------------------------------------------------------------------------
  // Defaults
  // ---------------------------------------------------------------------------
  defaults: {
    position: "fullscreen_below",
    opacity: 0.7,
    blur: "1.5px",
    vignette: 0.32,
    videoPlaybackRate: 1,
    transitionSpeed: 800,
    spriteSheets: {
      clear: { day: "videos/clear-day.mp4", night: "videos/clear-night.mp4" },
      partly_cloudy: {
        day: "videos/partly-cloudy-day.mp4",
        night: "videos/partly-cloudy-night.mp4"
      },
      cloudy: { day: "videos/cloudy-day.mp4", night: "videos/cloudy-night.mp4" },
      rain: { day: "videos/rain-day.mp4", night: "videos/rain-day.mp4" },
      sleet: { day: "videos/rain-day.mp4", night: "videos/rain-day.mp4" },
      thunderstorm: { day: "videos/rain-day.mp4", night: "videos/rain-day.mp4" },
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
    this.sunTimes = { sunrise: null, sunset: null };
    this.manualOverride = null;
    this.rootEl = null;
    this.spriteMeta = { type: "video", playbackRate: this.config.videoPlaybackRate || 1 };
    this.spriteUrl = null;
    this.videoEl = null;

    // Set an initial backdrop so something renders before weather notifications land.
    this.applyScene("default", false);
  },

  // ---------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------
  getDom() {
    if (this.rootEl) {
      // Reuse existing DOM to avoid unnecessary video reloads during other module animations.
      if (this.videoEl && this.spriteUrl && this.videoEl.paused) {
        this.videoEl.play().catch((err) => {
          Log.warn(`[${this.name}] Video resume failed: ${err?.message || err}`);
        });
      }
      return this.rootEl;
    }

    const root = document.createElement("div");
    root.className = "mmm-awb";
    root.style.setProperty("--awb-opacity", this.config.opacity);
    root.style.setProperty("--awb-blur", this.config.blur);
    root.style.setProperty("--awb-vignette", this.config.vignette);

    const video = document.createElement("video");
    video.className = "mmm-awb__video";
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.autoplay = true;
    video.setAttribute("preload", "auto");

    const tint = document.createElement("div");
    tint.className = "mmm-awb__tint";

    root.appendChild(video);
    root.appendChild(tint);

    this.rootEl = root;
    this.videoEl = video;
    this.applySprite();

    return root;
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
    } else if (notification === "ANIMATED_WEATHER_BACKGROUND_SET") {
      this.handleManualSet(payload);
    } else if (notification === "ANIMATED_WEATHER_BACKGROUND_CLEAR") {
      this.manualOverride = null;
      if (this.scene) {
        this.applyScene(this.scene, this.isNight);
      }
    }
  },

  handleAmbientWeather(payload) {
    if (!payload) return;

    this.sunTimes = {
      sunrise: this.parseTimestamp(payload.sunrise),
      sunset: this.parseTimestamp(payload.sunset)
    };

    const isNight =
      typeof payload.isDaytime === "boolean"
        ? !payload.isDaytime
        : this.resolveNightFlag(null);

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
      if (this.videoEl && this.videoEl.paused) {
        this.videoEl.play().catch((err) => {
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

  applySprite() {
    if (!this.videoEl) return;

    const isVideo = this.spriteMeta.type === "video";

    this.videoEl.style.transitionDuration = `${this.config.transitionSpeed}ms`;

    if (isVideo) {
      if (this.spriteUrl) {
        const absoluteUrl = new URL(this.spriteUrl, window.location.origin).href;
        if (this.videoEl.currentSrc !== absoluteUrl && this.videoEl.src !== absoluteUrl) {
          this.videoEl.src = absoluteUrl;
          this.videoEl.load();
        }
        this.videoEl.muted = true;
        this.videoEl.playsInline = true;
        this.videoEl.autoplay = true;
        this.videoEl.loop = true;
        this.videoEl.playbackRate = this.spriteMeta.playbackRate || 1;
        this.videoEl.oncanplay = () => {
          this.videoEl.play().catch((err) => {
            Log.warn(`[${this.name}] Video playback failed: ${err?.message || err}`);
          });
        };
        this.videoEl.play().catch((err) => {
          Log.warn(`[${this.name}] Video playback failed: ${err?.message || err}`);
        });
        this.videoEl.classList.add("is-visible");
      } else {
        this.videoEl.pause();
        this.videoEl.classList.remove("is-visible");
      }
    } else {
      this.videoEl.pause();
      this.videoEl.classList.remove("is-visible");
      Log.warn(`[${this.name}] Non-video media is not supported after sprite removal. Given url: ${this.spriteUrl}`);
    }
  },

  normalizeWeather(type) {
    const raw = (type || "").toLowerCase();
    const isNightHint = raw.includes("night");
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

    return false;
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

  suspend() {
    // Keep playing during suspend to avoid restart when modules animate between pages.
    // No-op by design. Also avoid clearing scene signature.
  },

  resume() {
    // No-op; playback continues from suspend.
  }
});
