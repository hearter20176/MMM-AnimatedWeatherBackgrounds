MM.getModules()
  .withClass("MMM-AnimatedWeatherBackgrounds")[0]
  .sendNotification("ANIMATED_WEATHER_BACKGROUND_SET", {
    scene: "rain",     // try: clear, partly_cloudy, cloudy, rain, sleet, thunderstorm, snow, fog, wind
    isNight: false,    // true to force night
    frameCount: 60,
    fps: 24
  });