"""Explicit demo inputs for the existing frozen runtime; no model or policy changes."""
import math
import json
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from urllib.request import urlopen
from urllib.parse import urlencode


def local_inputs(now, soc=50., cloud_cover=35., timezone_name='America/Sao_Paulo'):
    local = now.astimezone(ZoneInfo(timezone_name))
    hour = local.hour + local.minute / 60 + local.second / 3600
    daylight = max(0., math.sin(math.pi * (hour - 6) / 12)) if 6 < hour < 18 else 0.
    solar = min(500., 480. * daylight * (1. - .75 * min(100., max(0., cloud_cover)) / 100.))
    building = 70. + 90. * max(0., math.sin(math.pi * (hour - 5) / 18))
    return dict(timestamp=now.isoformat(), building_kw=round(building, 3), solar_kw=round(solar, 3), battery_soc_pct=soc, _mode='NORMAL')


class NormalDemo:
    def __init__(self, weather=False, clock=None, transport=None):
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self.transport = transport or self._fetch
        self.weather = weather
        self.soc = 50.
        self.last_at = None
        self.previous = None
        self.result = None
        self.weather_due = 0.
        self.cloud = 35.
        self.weather_source = 'local_time_fallback'

    @staticmethod
    def _fetch(url):
        with urlopen(url, timeout=1.5) as r:
            return json.load(r)

    def sample(self, context):
        now = self.clock()
        if self.result and self.last_at:
            n = self.result['numeric_state']
            # Actual elapsed seconds, never the optimizer's 15-minute SOC projection.
            seconds = min(15., max(0., (now - self.last_at).total_seconds()))
            if self.result['execution_allowed']:
                change = ((n.get('battery_charge_kw') or 0) * .95 - (n.get('battery_discharge_kw') or 0) / .95) * seconds / 3600
                self.soc = min(95., max(20., self.soc + 100 * change / 2000))
        if self.weather and context.get('latitude') is not None and time.monotonic() >= self.weather_due:
            self.weather_due = time.monotonic() + 1200
            try:
                url = 'https://api.open-meteo.com/v1/forecast?' + urlencode(dict(latitude=context['latitude'], longitude=context['longitude'], current='cloud_cover', timezone='UTC'))
                raw = self.transport(url)
                cloud = float(raw['current']['cloud_cover'])
                measured = datetime.fromisoformat(raw['current']['time'].replace('Z', '+00:00')).replace(tzinfo=timezone.utc)
                if not math.isfinite(cloud) or not 0 <= cloud <= 100 or abs((now - measured).total_seconds()) > 7200:
                    raise ValueError('Stale or invalid weather')
                self.cloud, self.weather_source = cloud, 'open_meteo_cloud_cover'
            except Exception:
                self.cloud, self.weather_source = 35., 'local_time_fallback'
        self.last_at = now
        return local_inputs(now, self.soc, self.cloud, context.get('timezone') or 'America/Sao_Paulo')
