import { localDay, numeric, safeTimezone } from './station-monitoring';

export type WeatherDay = {
  day: string; at: number; code: number | null;
  minimum: number | null; maximum: number | null;
  sunrise: number | null; sunset: number | null;
  humidity: number | null; wind: number | null;
};
export type StationWeather = {
  temperature: number | null; humidity: number | null; wind: number | null;
  code: number | null; isDay: boolean; time: number; days: WeatherDay[];
};
const codes = new Set([0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]);
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const percent = (value: unknown) => { const n = numeric(value); return n !== null && n >= 0 && n <= 100 ? n : null; };
const wind = (value: unknown) => { const n = numeric(value); return n !== null && n >= 0 ? n : null; };
const code = (value: unknown) => { const n = numeric(value); return n !== null && codes.has(n) ? n : null; };
const timestamp = (value: unknown) => { const n = numeric(value); return n !== null && n >= 0 && n * 1000 <= 8.64e15 ? n * 1000 : null; };

export function weatherLocationKey(latitude: unknown, longitude: unknown, timezone: string) {
  const lat = numeric(latitude), lon = numeric(longitude);
  return lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? `${lat.toFixed(2)},${lon.toFixed(2)},${safeTimezone(timezone)}` : '';
}

export function weatherQuery(key: string) {
  const [latitude, longitude, timezone] = key.split(',');
  return new URLSearchParams({ latitude, longitude, timezone,
    current: 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,is_day',
    daily: 'weather_code,temperature_2m_min,temperature_2m_max,sunrise,sunset,wind_speed_10m_max,relative_humidity_2m_mean',
    forecast_days: '5', timeformat: 'unixtime', temperature_unit: 'celsius', wind_speed_unit: 'kmh' });
}

export function parseWeather(body: unknown, timezone: string): StationWeather {
  const root = record(body), current = record(root.current), daily = record(root.daily);
  const time = timestamp(current.time);
  if (time === null) throw new Error('Invalid weather time');
  const today = localDay(new Date(time), timezone);
  const times = Array.isArray(daily.time) ? daily.time : [];
  const atIndex = (key: string, index: number) => Array.isArray(daily[key]) ? daily[key][index] : null;
  const days = new Map<string, WeatherDay>();
  times.forEach((value, index) => {
    const at = timestamp(value);
    if (at === null) return;
    const day = localDay(new Date(at), timezone);
    if (day < today || days.has(day)) return;
    let minimum = numeric(atIndex('temperature_2m_min', index)), maximum = numeric(atIndex('temperature_2m_max', index));
    if (minimum !== null && maximum !== null && minimum > maximum) { minimum = null; maximum = null; }
    days.set(day, { day, at, minimum, maximum, code: code(atIndex('weather_code', index)),
      sunrise: timestamp(atIndex('sunrise', index)), sunset: timestamp(atIndex('sunset', index)),
      humidity: percent(atIndex('relative_humidity_2m_mean', index)), wind: wind(atIndex('wind_speed_10m_max', index)) });
  });
  return { time, temperature: numeric(current.temperature_2m), humidity: percent(current.relative_humidity_2m),
    wind: wind(current.wind_speed_10m), code: code(current.weather_code), isDay: current.is_day === 1,
    days: [...days.values()].sort((a, b) => a.at - b.at).slice(0, 5) };
}

export function weatherKind(value: number | null) {
  if (value === 0) return 'clear';
  if (value === 1 || value === 2) return 'partly';
  if (value === 3) return 'cloud';
  if (value === 45 || value === 48) return 'fog';
  if (value !== null && value >= 51 && value <= 57) return 'drizzle';
  if (value !== null && (value >= 61 && value <= 67 || value >= 80 && value <= 82)) return 'rain';
  if (value !== null && (value >= 71 && value <= 77 || value === 85 || value === 86)) return 'snow';
  if (value === 95 || value === 96 || value === 99) return 'storm';
  return 'unknown';
}
export function weatherLabel(value: number | null) {
  return { clear: 'Céu limpo', partly: 'Parcialmente nublado', cloud: 'Nublado', fog: 'Neblina', drizzle: 'Garoa', rain: 'Chuva', snow: 'Neve', storm: 'Trovoadas', unknown: 'Clima' }[weatherKind(value)];
}
