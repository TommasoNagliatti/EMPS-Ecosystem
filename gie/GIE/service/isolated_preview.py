"""Authenticated, GET-only replay of existing GIE scenes. No database or hardware."""
import os
import re
import secrets
import threading
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, Header, HTTPException
from gie_control import GIEControl

SOURCE = "LOCAL_ISOLATED_GIE_DEMO"


def create_app(env=None, control=None):
    env = os.environ if env is None else env
    token = env.get("EMPS_LOCAL_GIE_TOKEN", "")
    station = env.get("EMPS_LOCAL_GIE_STATION_ID", "")
    if env.get("EMPS_LOCAL_GIE_DEMO") != "true" or not re.fullmatch(r"[1-9]\d*", station):
        raise RuntimeError("Explicit local demo and station required")
    if not re.fullmatch(r"[a-zA-Z0-9_-]{32,128}", token):
        raise RuntimeError("Private local demo token required")
    if any(env.get(key) for key in ("DATABASE_URL", "JWT_SECRET", "GIE_SERVICE_URL", "GIE_SERVICE_TOKEN", "STRIPE_SECRET_KEY", "OCPP_GATEWAY_URL")):
        raise RuntimeError("Isolated GIE must not receive database or operational credentials")
    c = control or GIEControl()
    c.set_mode("PRESENTATION")
    c.set_scene("05")
    c.set_presentation_interval(10)
    c.set_loop(True)
    c.start_presentation()
    lock = threading.RLock()

    def authenticate(authorization: str | None = Header(default=None)):
        if not secrets.compare_digest(authorization or "", "Bearer " + token):
            raise HTTPException(401, "Local demo authentication required")

    app = FastAPI(title="Isolated GIE preview", dependencies=[Depends(authenticate)],
                  docs_url=None, redoc_url=None, openapi_url=None)

    def identity():
        return {"station_id": station, "source": SOURCE, "isolated": True, "hardware_confirmed": False}

    @app.get("/health")
    def health():
        return {**identity(), "status": "ok"}

    @app.get("/state")
    def state():
        with lock:
            c.tick()
            result = c.get_state()
            powers = result.get("numeric_state", {}).get("evse_setpoints_kw") or [None] * 4
            return {**identity(), "observed_at": datetime.now(timezone.utc).isoformat(), "mode": "PRESENTATION",
                    "presentation": c.get_presentation_state(), "state": result,
                    "context": {"demands": [{"charger_id": f"virtual-evse-{slot}", "evse_slot": slot,
                                             "session_id": None, "connected": power is not None and power > 0}
                                            for slot, power in enumerate(powers, start=1)]}}

    return app
