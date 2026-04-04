import config from '../config.js';

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [tool:weather] ${label}`, data ?? '');
}

const WMO_CODES = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Icy fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Light showers', 81: 'Showers', 82: 'Heavy showers',
  85: 'Light snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with heavy hail'
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return `${DAY_NAMES[d.getDay()]} ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
}

export async function getWeather({ days = 7 } = {}) {
  const lat = config.tools?.weather?.lat;
  const lon = config.tools?.weather?.lon;
  if (lat == null || lon == null) throw new Error('weather.lat and weather.lon not set in config.json');

  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode',
    current_weather: 'true',
    forecast_days: Math.min(days, 16),
    timezone: 'auto'
  });

  log('query', `lat=${lat} lon=${lon} days=${days}`);

  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) throw new Error(`Weather API error: ${res.status}`);
  const data = await res.json();

  const lines = [];

  if (data.current_weather) {
    const cw = data.current_weather;
    const desc = WMO_CODES[cw.weathercode] ?? `Code ${cw.weathercode}`;
    lines.push(`Now: ${desc}, ${cw.temperature}°C, wind ${cw.windspeed} km/h`);
  }

  const { time, temperature_2m_max, temperature_2m_min, precipitation_sum, weathercode } = data.daily;
  for (let i = 0; i < time.length; i++) {
    const desc = WMO_CODES[weathercode[i]] ?? `Code ${weathercode[i]}`;
    const rain = precipitation_sum[i] > 0 ? `, ${precipitation_sum[i]}mm rain` : '';
    lines.push(`${formatDate(time[i])}: ${desc}, ${Math.round(temperature_2m_max[i])}°C / ${Math.round(temperature_2m_min[i])}°C${rain}`);
  }

  log('results', `${time.length} days`);
  return lines.join('\n');
}
