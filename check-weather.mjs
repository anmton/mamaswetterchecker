const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;
const OPENWEATHER_LAT = process.env.OPENWEATHER_LAT;
const OPENWEATHER_LON = process.env.OPENWEATHER_LON;
const OPENWEATHER_UNITS = process.env.OPENWEATHER_UNITS || "metric";
const OPENWEATHER_LANG = process.env.OPENWEATHER_LANG || "de";
const NTFY_URL = process.env.NTFY_URL;
const TEMP_THRESHOLD_C = Number(process.env.TEMP_THRESHOLD_C ?? "3");

function requireEnv(name, value) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

function formatTemp(temp) {
  return temp.toFixed(1).replace(".", ",");
}

function isWithinNext24Hours(timestampSeconds, nowMs) {
  const forecastMs = timestampSeconds * 1000;
  return forecastMs >= nowMs && forecastMs <= nowMs + 24 * 60 * 60 * 1000;
}

function isNightHour(hour) {
  return hour >= 21 || hour <= 7;
}

function getLocalHour(timestampSeconds, timezoneOffsetSeconds) {
  const utcMs = timestampSeconds * 1000;
  const localMs = utcMs + timezoneOffsetSeconds * 1000;
  return new Date(localMs).getUTCHours();
}

async function fetchForecast() {
  const url = new URL("https://api.openweathermap.org/data/2.5/forecast");
  url.searchParams.set("lat", OPENWEATHER_LAT);
  url.searchParams.set("lon", OPENWEATHER_LON);
  url.searchParams.set("appid", OPENWEATHER_API_KEY);
  url.searchParams.set("units", OPENWEATHER_UNITS);
  url.searchParams.set("lang", OPENWEATHER_LANG);

  const response = await fetch(url, {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenWeather request failed (${response.status}): ${body}`);
  }

  return response.json();
}

async function sendNotification(message, cityName) {
  const response = await fetch(NTFY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      Title: "Frostwarnung",
      Priority: "urgent",
      Tags: "warning,thermometer,snowflake",
      Click: "https://openweathermap.org/"
    },
    body: `${message}\n\nOrt: ${cityName}`
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ntfy request failed (${response.status}): ${body}`);
  }
}

async function main() {
  requireEnv("OPENWEATHER_API_KEY", OPENWEATHER_API_KEY);
  requireEnv("OPENWEATHER_LAT", OPENWEATHER_LAT);
  requireEnv("OPENWEATHER_LON", OPENWEATHER_LON);
  requireEnv("NTFY_URL", NTFY_URL);

  const forecast = await fetchForecast();
  const nowMs = Date.now();
  const timezoneOffsetSeconds = forecast.city?.timezone ?? 0;
  const upcomingForecasts = (forecast.list ?? []).filter((entry) =>
    isWithinNext24Hours(entry.dt, nowMs)
  );

  if (upcomingForecasts.length === 0) {
    console.log("No forecast data found for the next 24 hours.");
    return;
  }

  const nightForecasts = upcomingForecasts.filter((entry) =>
    isNightHour(getLocalHour(entry.dt, timezoneOffsetSeconds))
  );
  const candidates = nightForecasts.length > 0 ? nightForecasts : upcomingForecasts;

  const coldest = candidates.reduce((lowest, current) => {
    if (!lowest) {
      return current;
    }

    return current.main.temp < lowest.main.temp ? current : lowest;
  }, null);

  if (!coldest) {
    console.log("No valid temperature entry found.");
    return;
  }

  const coldestTemp = coldest.main.temp;
  const coldestLocalHour = getLocalHour(coldest.dt, timezoneOffsetSeconds);
  const reason = nightForecasts.length > 0 ? "night" : "next_24_hours";

  console.log(
    JSON.stringify(
      {
        checkedAt: new Date(nowMs).toISOString(),
        city: forecast.city?.name,
        coldestTemp,
        coldestLocalHour,
        reason,
        threshold: TEMP_THRESHOLD_C
      },
      null,
      2
    )
  );

  if (coldestTemp >= TEMP_THRESHOLD_C) {
    console.log("Threshold not reached. No notification sent.");
    return;
  }

  const message =
    reason === "night"
      ? `Es werden ${formatTemp(coldestTemp)} Grad heute Nacht, Hol die Pflanzen rein.`
      : `Es werden ${formatTemp(coldestTemp)} Grad in den naechsten 24 Stunden, Hol die Pflanzen rein.`;

  await sendNotification(message, forecast.city?.name ?? "Unbekannt");
  console.log("Notification sent.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
