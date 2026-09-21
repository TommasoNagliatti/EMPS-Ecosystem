from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from math import ceil
from typing import Iterable, Optional, Any

MONEY = Decimal("0.01")
ENERGY = Decimal("0.0001")

def D(value: Any) -> Decimal:
    return value if isinstance(value, Decimal) else Decimal(str(value))

def money(value: Any) -> Decimal:
    return D(value).quantize(MONEY, rounding=ROUND_HALF_UP)

def energy(value: Any) -> Decimal:
    return D(value).quantize(ENERGY, rounding=ROUND_HALF_UP)

def s(value: Optional[Decimal]) -> Optional[str]:
    return None if value is None else format(value, "f")

def require_aware(dt: datetime, field: str) -> None:
    if dt.tzinfo is None or dt.utcoffset() is None:
        raise ValueError(f"{field} must be timezone-aware.")

@dataclass(frozen=True)
class TariffConfig:
    version: str = "SP_ENEL_PROTO_V1"
    area_code: str = "SP_ENEL"
    currency: str = "BRL"

    base_tariff_per_kwh: Decimal = Decimal("1.99")
    grid_surcharge_per_kwh: Decimal = Decimal("0.20")
    high_demand_surcharge_per_kwh: Decimal = Decimal("0.10")
    max_tariff_per_kwh: Decimal = Decimal("2.29")

    overstay_grace_minutes: int = 15
    overstay_fee_per_minute: Decimal = Decimal("0.25")
    overstay_fee_cap: Decimal = Decimal("20.00")

    owner_margin_per_kwh: Decimal = Decimal("0.20")
    platform_fee_per_kwh: Decimal = Decimal("0.10")

    def validate(self) -> "TariffConfig":
        for name in (
            "base_tariff_per_kwh", "grid_surcharge_per_kwh",
            "high_demand_surcharge_per_kwh", "max_tariff_per_kwh",
            "overstay_fee_per_minute", "overstay_fee_cap",
            "owner_margin_per_kwh", "platform_fee_per_kwh"
        ):
            if getattr(self, name) < 0:
                raise ValueError(f"{name} cannot be negative.")
        if not self.version.strip() or not self.area_code.strip():
            raise ValueError("version and area_code are required.")
        if self.currency != "BRL":
            raise ValueError("Prototype V1 supports BRL only.")
        if self.overstay_grace_minutes < 0:
            raise ValueError("overstay_grace_minutes cannot be negative.")
        if self.base_tariff_per_kwh > self.max_tariff_per_kwh:
            raise ValueError("base tariff cannot exceed cap.")
        if (
            self.base_tariff_per_kwh
            + self.grid_surcharge_per_kwh
            + self.high_demand_surcharge_per_kwh
            > self.max_tariff_per_kwh
        ):
            raise ValueError("Configured surcharges exceed max tariff.")
        if self.owner_margin_per_kwh + self.platform_fee_per_kwh > self.base_tariff_per_kwh:
            raise ValueError("Internal allocations exceed base tariff.")
        return self

@dataclass(frozen=True)
class EnergyInterval:
    start_at: datetime
    end_at: datetime
    energy_kwh: Decimal
    grid_support_for_ev: bool = False
    high_demand: bool = False

    def validate(self) -> "EnergyInterval":
        require_aware(self.start_at, "start_at")
        require_aware(self.end_at, "end_at")
        if self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at.")
        if D(self.energy_kwh) < 0:
            raise ValueError("energy_kwh cannot be negative.")
        if type(self.grid_support_for_ev) is not bool:
            raise ValueError("grid_support_for_ev must be bool.")
        if type(self.high_demand) is not bool:
            raise ValueError("high_demand must be bool.")
        return self

@dataclass(frozen=True)
class SessionBillingInput:
    session_id: str
    area_code: str
    intervals: tuple[EnergyInterval, ...]
    charge_completed_at: Optional[datetime] = None
    disconnected_at: Optional[datetime] = None

    def validate(self) -> "SessionBillingInput":
        if not self.session_id.strip():
            raise ValueError("session_id is required.")
        if not self.area_code.strip():
            raise ValueError("area_code is required.")
        ordered = sorted(self.intervals, key=lambda x: x.start_at)
        for interval in ordered:
            interval.validate()
        for previous, current in zip(ordered, ordered[1:]):
            if current.start_at < previous.end_at:
                raise ValueError("Energy intervals cannot overlap.")
        if self.charge_completed_at is not None:
            require_aware(self.charge_completed_at, "charge_completed_at")
        if self.disconnected_at is not None:
            require_aware(self.disconnected_at, "disconnected_at")
        if self.disconnected_at is not None and self.charge_completed_at is None:
            raise ValueError("disconnected_at requires charge_completed_at.")
        if (
            self.charge_completed_at is not None
            and self.disconnected_at is not None
            and self.disconnected_at < self.charge_completed_at
        ):
            raise ValueError("disconnected_at cannot precede charge_completed_at.")
        return self

class TariffEngine:
    def __init__(self, configs: Iterable[TariffConfig]):
        items = [cfg.validate() for cfg in configs]
        self.configs = {cfg.area_code: cfg for cfg in items}
        if len(self.configs) != len(items):
            raise ValueError("Duplicate area_code.")

    def config_for(self, area_code: str) -> TariffConfig:
        if area_code not in self.configs:
            raise ValueError(f"Unsupported tariff area: {area_code}")
        return self.configs[area_code]

    @staticmethod
    def _rate(cfg: TariffConfig, grid: bool, peak: bool) -> Decimal:
        rate = cfg.base_tariff_per_kwh
        if grid:
            rate += cfg.grid_surcharge_per_kwh
        if peak:
            rate += cfg.high_demand_surcharge_per_kwh
        return min(rate, cfg.max_tariff_per_kwh)

    def quote(self, area_code: str, *, grid_support_for_ev=False, high_demand=False) -> dict:
        cfg = self.config_for(area_code)
        rate = self._rate(cfg, grid_support_for_ev, high_demand)
        return {
            "tariff_version": cfg.version,
            "area_code": cfg.area_code,
            "currency": cfg.currency,
            "current_tariff_per_kwh": s(rate),
            "minimum_tariff_per_kwh": s(cfg.base_tariff_per_kwh),
            "maximum_tariff_per_kwh": s(cfg.max_tariff_per_kwh),
            "grid_surcharge_active": bool(grid_support_for_ev),
            "high_demand_surcharge_active": bool(high_demand),
            "overstay_grace_minutes": cfg.overstay_grace_minutes,
            "overstay_fee_per_minute": s(cfg.overstay_fee_per_minute),
            "overstay_fee_cap": s(cfg.overstay_fee_cap),
        }

    def _overstay(self, cfg: TariffConfig, completed, disconnected) -> dict:
        if completed is None or disconnected is None:
            return {
                "charge_completed_at": None if completed is None else completed.isoformat(),
                "disconnected_at": None if disconnected is None else disconnected.isoformat(),
                "grace_minutes": cfg.overstay_grace_minutes,
                "overstay_minutes_total": 0,
                "billable_minutes": 0,
                "fee_per_minute": s(cfg.overstay_fee_per_minute),
                "uncapped_fee": "0.00",
                "applied_fee": "0.00",
                "cap": s(cfg.overstay_fee_cap),
            }

        seconds = max(0.0, (disconnected - completed).total_seconds())
        total_minutes = ceil(seconds / 60) if seconds else 0
        billable = max(0, total_minutes - cfg.overstay_grace_minutes)
        uncapped = money(D(billable) * cfg.overstay_fee_per_minute)
        applied = min(uncapped, cfg.overstay_fee_cap)
        return {
            "charge_completed_at": completed.isoformat(),
            "disconnected_at": disconnected.isoformat(),
            "grace_minutes": cfg.overstay_grace_minutes,
            "overstay_minutes_total": total_minutes,
            "billable_minutes": billable,
            "fee_per_minute": s(cfg.overstay_fee_per_minute),
            "uncapped_fee": s(uncapped),
            "applied_fee": s(applied),
            "cap": s(cfg.overstay_fee_cap),
        }

    def calculate_session(self, billing: SessionBillingInput) -> dict:
        billing.validate()
        cfg = self.config_for(billing.area_code)

        total_energy = Decimal("0")
        energy_amount = Decimal("0")
        grid_energy = Decimal("0")
        peak_energy = Decimal("0")
        rows = []

        for item in sorted(billing.intervals, key=lambda x: x.start_at):
            kwh = energy(item.energy_kwh)
            rate = self._rate(cfg, item.grid_support_for_ev, item.high_demand)
            amount = money(kwh * rate)

            total_energy += kwh
            energy_amount += amount
            if item.grid_support_for_ev:
                grid_energy += kwh
            if item.high_demand:
                peak_energy += kwh

            rows.append({
                "start_at": item.start_at.isoformat(),
                "end_at": item.end_at.isoformat(),
                "energy_kwh": s(kwh),
                "tariff_per_kwh": s(rate),
                "base_tariff_per_kwh": s(cfg.base_tariff_per_kwh),
                "grid_surcharge_per_kwh": s(cfg.grid_surcharge_per_kwh if item.grid_support_for_ev else Decimal("0")),
                "high_demand_surcharge_per_kwh": s(cfg.high_demand_surcharge_per_kwh if item.high_demand else Decimal("0")),
                "grid_support_for_ev": item.grid_support_for_ev,
                "high_demand": item.high_demand,
                "amount": s(amount),
            })

        energy_amount = money(energy_amount)
        overstay = self._overstay(cfg, billing.charge_completed_at, billing.disconnected_at)
        overstay_fee = D(overstay["applied_fee"])
        total = money(energy_amount + overstay_fee)

        owner_energy = money(total_energy * cfg.owner_margin_per_kwh)
        platform_fee = money(total_energy * cfg.platform_fee_per_kwh)
        owner_total = money(owner_energy + overstay_fee)
        residual = money(max(Decimal("0"), energy_amount - owner_energy - platform_fee))
        effective_rate = money(energy_amount / total_energy) if total_energy > 0 else Decimal("0.00")

        return {
            "schema_version": "1.0",
            "session_id": billing.session_id,
            "tariff_version": cfg.version,
            "area_code": cfg.area_code,
            "currency": cfg.currency,
            "customer": {
                "energy_kwh": s(energy(total_energy)),
                "energy_amount": s(energy_amount),
                "overstay_fee": s(overstay_fee),
                "total_amount": s(total),
                "effective_energy_rate_per_kwh": s(effective_rate),
                "grid_supported_energy_kwh": s(energy(grid_energy)),
                "high_demand_energy_kwh": s(energy(peak_energy)),
            },
            "overstay": overstay,
            "intervals": rows,
            "internal_settlement_reference": {
                "note": "Prototype bookkeeping only; owner/platform shares are carved out of energy revenue.",
                "owner_energy_margin_reference": s(owner_energy),
                "owner_overstay_reference": s(overstay_fee),
                "owner_total_reference": s(owner_total),
                "platform_fee_reference": s(platform_fee),
                "residual_operating_pool": s(residual),
            },
        }

def build_prototype_engine() -> TariffEngine:
    return TariffEngine([TariffConfig()])
