# MMM-AnimatedWeatherBackgrounds

Fullscreen animated weather backdrops for MagicMirror. Listens to the core weather module (CURRENTWEATHER_TYPE / WEATHER_UPDATED) plus optional AmbientWeather payloads and maps conditions to looping video scenes.

## Features
- Day/night aware sprite selection with configurable sprite sheet map.
- Manual override notifications to force a scene or custom video URL.
- Gentle CSS tint/blur/vignette to blend behind other modules.
- Pi-friendly performance toggles (pause when hidden, reduced motion, lower playback rate).

## Installation
```bash
cd ~/MagicMirror/modules
git clone https://github.com/your-repo/MMM-AnimatedWeatherBackgrounds.git
cd MMM-AnimatedWeatherBackgrounds
npm install
```

## Configuration
Add to `config/config.js`:
```js
{
  module: "MMM-AnimatedWeatherBackgrounds",
  position: "fullscreen_below",
  config: {
    opacity: 0.7,
    blur: "1.5px",
    vignette: 0.32,
    videoPlaybackRate: 1,
    transitionSpeed: 800,

    spriteSheets: {
      clear: { day: "videos/clear-day.mp4", night: "videos/clear-night.mp4" },
      partly_cloudy: { day: "videos/partly-cloudy-day.mp4", night: "videos/partly-cloudy-night.mp4" },
      cloudy: { day: "videos/cloudy-day.mp4", night: "videos/cloudy-night.mp4" },
      rain: { day: "videos/rain-day.mp4", night: "videos/rain-day.mp4" },
      sleet: { day: "videos/rain-day.mp4", night: "videos/rain-day.mp4" },
      thunderstorm: { day: "videos/rain-day.mp4", night: "videos/rain-day.mp4" },
      snow: { day: "videos/cloudy-day.mp4", night: "videos/cloudy-night.mp4" },
      fog: { day: "videos/cloudy-day.mp4", night: "videos/cloudy-night.mp4" },
      wind: { day: "videos/cloudy-day.mp4", night: "videos/cloudy-night.mp4" },
      default: { day: "videos/clear-day.mp4", night: "videos/clear-night.mp4" }
    },

    // Performance
    performanceProfile: "auto", // "auto" | "pi" | "full"
    reduceMotion: false,        // true to honor reduced motion (Pi safe)
    pauseWhileHidden: true      // pause decode when pages/pages.js hide the module
  }
}
```

### Options
- `opacity`: Backdrop opacity (0-1). Default `0.7`.
- `blur`: CSS blur applied to the video. Default `1.5px`.
- `vignette`: 0-1 vignette strength. Default `0.32`.
- `videoPlaybackRate`: Multiplier for video speed. Default `1`.
- `transitionSpeed`: Milliseconds for fade between scenes. Default `800`.
- `spriteSheets`: Map of scene keys to `{ day, night }` video paths. Paths resolve via `this.file()`; absolute URLs and `/modules/...` are supported.
- `performanceProfile`: `"auto"` auto-detects Pi-like devices, `"pi"` forces low-power behavior, `"full"` leaves animations untouched.
- `reduceMotion`: Forces low-motion handling (lower playback rate, lighter preload).
- `pauseWhileHidden`: Pause playback when module is suspended/hidden by pages.

### Notifications
- Listens to `CURRENTWEATHER_TYPE`, `WEATHER_UPDATED`, `AMBIENT_WEATHER_DATA`.
- Manual overrides:
  - `ANIMATED_WEATHER_BACKGROUND_SET` `{ scene?, spriteUrl?, isNight?, playbackRate? }`
  - `ANIMATED_WEATHER_BACKGROUND_CLEAR`

## Notes
- Videos are loaded from the module folder by default; ensure your MP4/WebM files are present under `videos/`.
- For Raspberry Pi, prefer `performanceProfile: "pi"` and keep `videoPlaybackRate <= 0.85` for smoother playback.

## License
MIT
