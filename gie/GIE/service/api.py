"""One station, one serialized control instance. No hardware or commercial authority."""
import os
import secrets
import threading
import time
from copy import deepcopy
from datetime import datetime, timezone
from typing import Literal

import pandas as pd
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from service.normal_demo import NormalDemo, local_inputs
from load_balancer.state import BalancerState
from gie_control import GIEControl
from gie_control.outputs import standardize
from gie_control.scenarios import EVENTS, execute_demo, FrameForecast, LocalSolar
from gie_runtime import Components, History, CurrentState
from integracoes.weather.models import horizon
from load_balancer import EVSEState
from motor_gerenciamento_v2.runtime_adapter import run_cycle


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Demand(StrictModel):
    charger_id: str
    session_id: str | None = None
    evse_slot: int = Field(ge=1, le=4)
    requested_kw: float = Field(ge=0, le=22)
    connected: bool = False


class Context(StrictModel):
    station_id: str
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    timezone: str = "America/Sao_Paulo"
    demands: list[Demand] = Field(default_factory=list, max_length=4)


class Mode(StrictModel):
    mode: Literal["NORMAL", "SIMULATION", "PRESENTATION", "MANUAL_DEMO"]


class Event(StrictModel):
    event: str


class Cycle(StrictModel):
    decision_time: str
    current: dict
    building_history: list[dict]
    ev_history: list[dict]


def create_app(token=None, station_id=None, control=None):
    expected = token or os.getenv("GIE_SERVICE_TOKEN")
    station = station_id or os.getenv("GIE_STATION_ID")
    if not expected or len(expected) < 24 or not station:
        raise RuntimeError("Configure GIE_SERVICE_TOKEN (24+ characters) and GIE_STATION_ID")
    lock = threading.RLock()
    context = {"station_id": str(station), "demands": []}
    context_received = False
    c = control or GIEControl()
    normal = NormalDemo(weather=os.getenv('GIE_WEATHER_ENABLED', 'false').lower() == 'true')
    normal_enabled = os.getenv('GIE_NORMAL_DEMO', 'false').lower() == 'true'
    normal_due = 0.
    context_at = 0.

    def context_demo(source, root=None, previous=None):
        if not context_received and source.get('_mode') != 'NORMAL':
            return execute_demo(source, root=root, previous=previous)
        # Input adapter only: forecasts retain the documented explicit demo assumptions.
        # Stable physical slots come from the backend; the frozen MPC/LB decides power.
        s = deepcopy(source)
        t = pd.Timestamp(s["timestamp"])
        if s.get("_mode") == "NORMAL":
            t = t.tz_convert("America/Sao_Paulo").floor("15min")
        ix = horizon(t)
        demands = {d["evse_slot"]: d for d in context["demands"]}
        ev = sum(d["requested_kw"] for d in demands.values() if d["connected"])
        devices = []
        for slot in range(1, 5):
            d = demands.get(slot, {})
            connected = bool(d.get("connected"))
            fault = s.get("fault") == f"EVSE{slot}" or f"EVSE{slot}" in s.get("faults", [])
            devices.append(EVSEState(f"EVSE{slot}", connected, "fault" if fault else "available",
                                     d.get("requested_kw", 0), 22., t.isoformat() if connected else None))
        a = pd.DataFrame({"timestamp_previsto": ix.tz_localize(None), "consumo_previsto_kw": s["building_kw"]})
        a.loc[a.index[1:], "consumo_previsto_kw"] = min(s["building_kw"], 200)
        b = pd.DataFrame({"timestamp_previsto": ix.tz_localize(None), "potencia_solicitada_prevista_kw": ev,
                          "potencia_solicitada_alta_kw": ev, "energia_solicitada_prevista_kwh": ev * .25,
                          "carregadores_ocupados_previstos": sum(d["connected"] for d in demands.values()),
                          "carros_chegando_previstos": 0., "carros_na_fila_previstos": 0., "probabilidade_fila": 0.})
        solar = pd.DataFrame({"solar_previsto_kw": s["solar_kw"]}, index=ix)
        if s.get('_mode') == 'NORMAL':
            forecast = [local_inputs(ts.to_pydatetime(), normal.soc, normal.cloud, context.get('timezone') or 'America/Sao_Paulo') for ts in ix]
            a['consumo_previsto_kw'] = [f['building_kw'] for f in forecast]
            solar['solar_previsto_kw'] = [f['solar_kw'] for f in forecast]
            a.loc[a.index[0], 'consumo_previsto_kw'] = s['building_kw']
            solar.loc[solar.index[0], 'solar_previsto_kw'] = s['solar_kw']
        h = pd.DataFrame({"fixture": [0]}, index=[(t - pd.Timedelta(minutes=15)).tz_localize(None)])
        raw = run_cycle(t, History(h, h, {"kind": "explicit demo forecasts"}),
                        CurrentState(t, s["building_kw"], ev, s["solar_kw"], s["battery_soc_pct"], devices),
                        Components(FrameForecast(a), FrameForecast(b), LocalSolar(solar)),
                        config=c.engine.config, balancer_state=previous)
        return standardize(raw, s.get("_mode", "MANUAL_DEMO"), {"normal_demo": s.get("_mode") == "NORMAL", "weather_source": normal.weather_source if s.get("_mode") == "NORMAL" else "manual", "input_source": "EMPS session demand + explicit demo building/solar/SOC",
                           "station_id": str(station), "hardware_confirmed": False})

    c.demo_runner = context_demo

    def normal_tick(force=False):
        nonlocal normal_due
        if not normal_enabled or c.get_mode() != 'NORMAL':
            return
        if not context_received or time.monotonic() - context_at > 15:
            c.result = None
            normal.result = None
            return
        if not force and time.monotonic() < normal_due:
            return
        normal_due = time.monotonic() + 5
        source = normal.sample(context)
        result = context_demo(source, previous=normal.previous)
        normal.result = result
        if result['execution_allowed']:
            normal.previous = BalancerState(**result['load_balancer']['next_state'])
        c._store(result)

    def authenticate(authorization: str | None = Header(default=None)):
        if not secrets.compare_digest(authorization or "", "Bearer " + expected):
            raise HTTPException(401, "Service authentication required")

    app = FastAPI(title="EMPS GIE Service", dependencies=[Depends(authenticate)], docs_url=None, redoc_url=None)

    def state():
        return {"station_id": str(station), "observed_at": datetime.now(timezone.utc).isoformat(),
                "mode": c.get_mode(), "presentation": c.get_presentation_state(),
                "state": c.get_state(), "context": deepcopy(context), "manual_events": EVENTS,
                "source": "GIEControl", "hardware_confirmed": False}

    @app.get("/health")
    def health():
        return {"status": "ok", "station_id": str(station), "hardware_confirmed": False}

    @app.get("/state")
    def get_state():
        with lock:
            c.tick()  # presentation never starts autoplay
            normal_tick()
            return state()

    @app.get("/mode")
    def get_mode():
        with lock:
            return {"mode": c.get_mode()}

    @app.post("/mode")
    def set_mode(body: Mode):
        with lock:
            c.set_mode(body.mode)
            normal.result = None
            normal_tick(force=True)
            return state()

    @app.post("/context")
    def set_context(body: Context):
        nonlocal context_received, context_at
        with lock:
            if body.station_id != str(station):
                raise HTTPException(409, "Station does not match this service instance")
            if len({d.evse_slot for d in body.demands}) != len(body.demands):
                raise HTTPException(422, "Duplicate EVSE slot")
            if len({d.charger_id for d in body.demands}) != len(body.demands):
                raise HTTPException(422, "Duplicate charger")
            changed = context != body.model_dump() or not context_received
            context.update(body.model_dump())
            context_received = True
            context_at = time.monotonic()
            normal_tick(force=changed)
            if changed and c.get_mode() == "MANUAL_DEMO":
                c._store(context_demo(c.demo_input, previous=c.demo_previous))
            return state()

    # Actions call the existing control API; no reflection on arbitrary user method names.
    actions = {"start": c.start_presentation, "pause": c.pause_presentation,
               "resume": c.resume_presentation, "next": c.next_scene,
               "previous": c.previous_scene, "reset": c.stop_presentation}

    @app.post("/presentation/{action}")
    def presentation(action: str):
        with lock:
            if action not in actions:
                raise HTTPException(404, "Unknown presentation action")
            try:
                actions[action]()
            except ValueError as error:
                raise HTTPException(409, str(error)) from error
            return state()

    @app.post("/manual-demo/event")
    def event(body: Event):
        with lock:
            try:
                c.reset_demo() if body.event == "RESET" else c.trigger_demo_event(body.event)
            except ValueError as error:
                raise HTTPException(409, str(error)) from error
            return state()

    @app.post("/cycle")
    def cycle(body: Cycle):
        with lock:
            try:
                current = dict(body.current)
                current["evses"] = [EVSEState(**d) for d in current["evses"]]
                c.run_cycle(body.decision_time,
                            History(pd.DataFrame(body.building_history), pd.DataFrame(body.ev_history), {"source": "caller"}),
                            CurrentState(**current))
            except (ValueError, TypeError, KeyError) as error:
                raise HTTPException(422, str(error)) from error
            return state()

    return app
