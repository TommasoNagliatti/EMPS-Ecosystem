'use client';

import { useState } from 'react';
import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudMoon, CloudRain, CloudSnow, CloudSun, Droplets, LoaderCircle, Moon, RefreshCw, Sun, Sunrise, Sunset, Wind, X } from 'lucide-react';
import { localDay } from '@/domain/station-monitoring';
import { weatherKind, weatherLabel, type StationWeather } from '@/domain/station-weather';
import { Popover } from '@/components/ui/Popover';
import styles from './weather-popover.module.css';

type Forecast = { weather: StationWeather | null; loading: boolean; error: string; refresh: () => void };
type Props = { forecast: Forecast; timezone: string; city: string; measuredTemperature: number | null; measuredHumidity: number | null };
const value = (number: number | null | undefined, digits = 0) => number == null ? '--' : number.toLocaleString('pt-BR', { maximumFractionDigits: digits });

function WeatherSymbol({ code, isDay = true, size = 24 }: { code: number | null; isDay?: boolean; size?: number }) {
  const kind = weatherKind(code);
  const Icon = kind === 'clear' ? isDay ? Sun : Moon : kind === 'partly' ? isDay ? CloudSun : CloudMoon
    : kind === 'fog' ? CloudFog : kind === 'drizzle' ? CloudDrizzle : kind === 'rain' ? CloudRain
    : kind === 'snow' ? CloudSnow : kind === 'storm' ? CloudLightning : Cloud;
  return <Icon size={size} strokeWidth={1.6} aria-hidden="true" className={kind === 'clear' || kind === 'partly' ? styles.sun : styles.cloud} />;
}

function ForecastDetails({ forecast, timezone, city, measuredTemperature, measuredHumidity, close }: Props & { close: () => void }) {
  const [selection, setSelection] = useState<string | null>(null);
  const { weather, loading, error, refresh } = forecast;
  const today = weather ? localDay(new Date(weather.time), timezone) : '';
  const day = weather?.days.find(item => item.day === selection) ?? weather?.days.find(item => item.day === today);
  const current = !day || day.day === today;
  const clock = (time: number | null | undefined) => time == null ? '--:--' : new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(time));
  const dayName = (time: number) => new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, weekday: 'short' }).format(new Date(time)).replace('.', '');
  const date = (time: number) => new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, day: '2-digit', month: '2-digit' }).format(new Date(time));
  const temperature = measuredTemperature ?? weather?.temperature;
  return <>
    <div className={styles.heading}><div><strong>Previsão do tempo</strong>{city && <span>{city}</span>}</div><button type="button" className={styles.iconButton} aria-label="Fechar previsão do tempo" title="Fechar" onClick={close}><X size={17} /></button></div>
    {weather ? <>
      <div className={styles.details}>
        <div className={styles.summary}>
          <WeatherSymbol code={current ? weather.code : day?.code ?? null} isDay={current ? weather.isDay : true} size={46} />
          <div><strong className={styles.temperature}>{current ? `${value(temperature, 1)}°` : `${value(day?.minimum)}–${value(day?.maximum)}°`}</strong><span>{current ? 'Hoje' : day ? dayName(day.at) : ''} · {date(current ? weather.time : day!.at)}</span><small>{weatherLabel(current ? weather.code : day?.code ?? null)}</small></div>
          <div className={styles.range}><span>Mín. <b>{value(day?.minimum)}°</b></span><span>Máx. <b>{value(day?.maximum)}°</b></span></div>
        </div>
        <dl className={styles.metrics}>
          <div><Sunrise size={18} /><dt>Amanhecer</dt><dd>{clock(day?.sunrise)}</dd></div>
          <div><Sunset size={18} /><dt>Pôr do sol</dt><dd>{clock(day?.sunset)}</dd></div>
          <div><Wind size={18} /><dt>{current ? 'Vento' : 'Vento máximo'}</dt><dd>{value(current ? weather.wind : day?.wind, 1)} <small>km/h</small></dd></div>
          <div><Droplets size={18} /><dt>{current ? 'Umidade' : 'Umidade média'}</dt><dd>{value(current ? measuredHumidity ?? weather.humidity : day?.humidity)}<small>%</small></dd></div>
        </dl>
      </div>
      {weather.days.length > 0 ? <div className={styles.days} aria-label="Dias da previsão">{weather.days.map(item => <button type="button" key={item.day} aria-label={`Previsão de ${item.day === today ? 'hoje' : dayName(item.at)}, ${date(item.at)}`} aria-pressed={day?.day === item.day} className={day?.day === item.day ? styles.selected : ''} onClick={() => setSelection(item.day)}>
        <span>{item.day === today ? 'Hoje' : dayName(item.at)}</span><WeatherSymbol code={item.code} size={27} /><small>{value(item.minimum)}° <b>{value(item.maximum)}°</b></small>
      </button>)}</div> : <p className={styles.unavailable}>Previsão dos próximos dias indisponível.</p>}
      <div className={styles.footer}><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a><span>{current && (measuredTemperature !== null || measuredHumidity !== null) ? 'Sensores locais · ' : ''}{clock(weather.time)}</span><button type="button" className={styles.iconButton} disabled={loading} onClick={refresh} title="Atualizar previsão" aria-label="Atualizar previsão">{loading ? <LoaderCircle size={15} className={styles.loading} /> : <RefreshCw size={15} />}</button></div>
    </> : <div className={styles.empty} role="status">{loading ? <><LoaderCircle size={25} className={styles.loading} /><span>Consultando previsão…</span></> : <><Cloud size={30} /><span>{error || 'Previsão indisponível no momento.'}</span><button type="button" onClick={refresh}><RefreshCw size={15} /> Tentar novamente</button></>}</div>}
  </>;
}

export function WeatherPopover(props: Props) {
  const { weather, loading } = props.forecast;
  return <Popover label="Ver previsão do tempo" openOnHover align="start" className={styles.panel} buttonClassName={styles.trigger} trigger={<><WeatherSymbol code={weather?.code ?? null} isDay={weather?.isDay ?? true} size={23} /><strong>{value(props.measuredTemperature ?? weather?.temperature, 1)} °C</strong><span>{weather ? weatherLabel(weather.code) : loading ? 'Consultando clima' : 'Clima'}</span></>}>
    {close => <ForecastDetails {...props} close={close} />}
  </Popover>;
}
