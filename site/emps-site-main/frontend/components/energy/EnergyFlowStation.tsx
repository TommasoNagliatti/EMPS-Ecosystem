"use client";

import Image from "next/image";
import { useState } from "react";
import {
  Building2,
  BatteryCharging,
  SunMedium,
  UtilityPole,
  Zap,
} from "lucide-react";
import type { Charger, EnergyFlowTelemetry } from "@/domain/emps";
import { batteryLevel, getEnergyFlowState, simulateEnergyFlow, type EnergySimulationSettings } from "@/domain/energy-flow";
import { BatteryLevelOverlay, type BatteryVisualState } from "./BatteryLevelOverlay";
import { EnergySimulationControls } from "./EnergySimulationControls";

// Coordinates follow the supplied 1672 x 941 scene; image and overlays share this frame.
const routes = {
  grid:
    "M 76 286 C 180 270 274 239 337 200 M 417 201 C 507 245 595 251 695 251 L 772 210 L 1283 267 V 349 L 1456 382 V 430 L 1397 448 V 478 L 1373 483",
  solar: "M 987 371 L 1005 375 V 435 L 1298 495 L 1327 486",
  battery: "M 1350 524 V 551",
  chargerBus: "M 1328 514 L 1307 530 V 699 L 1003 806 L 910 780",
  chargerAlpha: "M 910 780 L 625 699 V 645",
  chargerBeta: "M 910 780 V 700",
};

const outletFlows = {
  left: `${routes.chargerBus} L 625 699 V 645`,
  right: `${routes.chargerBus} V 700`,
};

function EnergyRoute({
  active,
  className,
  path,
  flowPath,
  flowLane,
  reverse = false,
  showTrack = true,
  showFlow = true,
  routeId,
  tone,
}: {
  active: boolean;
  className: string;
  path: string;
  flowPath?: string;
  flowLane?: "in" | "out";
  reverse?: boolean;
  showTrack?: boolean;
  showFlow?: boolean;
  routeId: string;
  tone?: string;
}) {
  return (
    <g
      data-energy-route={routeId}
      className={`energy-route energy-route--${className}${
        tone ? ` energy-route--${tone}` : ""
      }${reverse ? " energy-route--reverse" : ""} energy-route--${
        active ? "active" : "inactive"
      }`}
    >
      {showTrack && <path className="energy-route__track" d={path} />}
      {showFlow && <path
        className={`energy-route__flow${flowPath ? " energy-route__flow--outlet" : ""}${flowLane ? ` energy-route__flow--battery-${flowLane}` : ""}`}
        d={flowPath ?? path}
        pathLength={flowPath ? undefined : 100}
      />}
    </g>
  );
}

function formatPower(value: number | null) {
  if (value === null) return "-- kW";

  return `${value.toLocaleString("pt-BR", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })} kW`;
}

export function EnergyFlowStation({
  chargers,
  telemetry,
  simulation = false,
}: {
  chargers: Charger[];
  telemetry: EnergyFlowTelemetry;
  simulation?: boolean;
}) {
  const [settings, setSettings] = useState<EnergySimulationSettings>(() => ({
    period: "day",
    batterySocPercent: batteryLevel(telemetry.batterySocPercent) ?? 68,
    solarPowerKw: 12,
  }));
  const displayedTelemetry = simulation ? simulateEnergyFlow(chargers, settings) : telemetry;
  const flow = getEnergyFlowState(chargers, displayedTelemetry);
  const batterySoc = flow.batterySoc;
  const duplexBattery = flow.solarChargesBattery && flow.batterySuppliesCars;
  const batteryState: BatteryVisualState =
    batterySoc !== null && batterySoc <= 15 && flow.batteryMode !== "charging"
      ? "critical"
      : flow.batteryMode;

  return (
    <section className="energy-flow" aria-labelledby="energy-flow-title">
      <header className="energy-flow__header">
        <div className="energy-flow__title">
          <span className="energy-flow__title-icon">
            <Zap size={15} aria-hidden="true" />
          </span>
          <div>
            <span>Distribuicao inteligente</span>
            <h3 id="energy-flow-title">Fluxo de energia do eletroposto</h3>
          </div>
        </div>
        <div className="energy-flow__header-actions">
          <span aria-live="polite" className="energy-flow__activity">
            <i aria-hidden="true" />
            Fluxo monitorado
          </span>
          {simulation && <EnergySimulationControls settings={settings} onChange={setSettings} />}
        </div>
      </header>

      <div className="energy-flow__scene">
        <Image
          alt="Eletroposto com rede publica, sala eletrica, carregadores e geracao solar"
          className="energy-flow__image"
          fill
          loading="eager"
          sizes="(max-width: 820px) 100vw, calc(100vw - 110px)"
          src="/emps-energy-station-v3.png"
        />
        <div className="energy-flow__contrast" aria-hidden="true" />

        <svg
          aria-hidden="true"
          className="energy-flow__routes"
          preserveAspectRatio="xMidYMid meet"
          viewBox="0 0 1672 941"
        >
          <EnergyRoute active={flow.gridSuppliesCars} className="grid" path={routes.grid} routeId="grid" />
          <EnergyRoute active={flow.solarChargesBattery} className="solar" path={routes.solar} routeId="solar" />
          <EnergyRoute
            active={flow.solarChargesBattery}
            className="battery"
            path={routes.battery}
            flowLane={duplexBattery ? "in" : undefined}
            tone="battery-charging"
            routeId="battery-charge"
          />
          <EnergyRoute
            active={flow.batterySuppliesCars}
            className="battery"
            path={routes.battery}
            flowLane={duplexBattery ? "out" : undefined}
            reverse
            showTrack={false}
            tone="battery-discharging"
            routeId="battery-discharge"
          />
          <EnergyRoute
            active={flow.supplyingCars}
            className="charger"
            path={routes.chargerBus}
            showFlow={false}
            routeId="charger-bus"
          />
          <EnergyRoute
            active={flow.leftActive}
            className="charger"
            path={routes.chargerAlpha}
            flowPath={outletFlows.left}
            routeId="charger-left"
          />
          <EnergyRoute
            active={flow.rightActive}
            className="charger"
            path={routes.chargerBeta}
            flowPath={outletFlows.right}
            routeId="charger-right"
          />

          <rect
            className={`energy-terminal energy-terminal--charger${
              flow.leftActive ? " energy-terminal--active" : ""
            }`}
            height="4"
            width="10"
            x="620"
            y="643"
          />
          <rect
            className={`energy-terminal energy-terminal--charger${
              flow.rightActive ? " energy-terminal--active" : ""
            }`}
            height="4"
            width="10"
            x="905"
            y="698"
          />
        </svg>

        <BatteryLevelOverlay percent={batterySoc} state={batteryState} />
        <div className={`energy-source energy-source--building energy-source--${(displayedTelemetry.buildingPowerKw??0)>0?'active':'inactive'}`}>
          <Building2 size={13} aria-hidden="true"/><span>Consumo do prédio</span><small>{formatPower(displayedTelemetry.buildingPowerKw??null)}</small>
        </div>

        <div
          className={`energy-source energy-source--grid energy-source--${
            flow.gridSuppliesCars ? "active" : "inactive"
          }`}
        >
          <UtilityPole size={15} aria-hidden="true" />
          <span>Rede</span>
          <small>{formatPower(displayedTelemetry.gridPowerKw)}</small>
        </div>
        <div
          className={`energy-source energy-source--solar energy-source--${
            flow.solarChargesBattery ? "active" : "inactive"
          }`}
        >
          <SunMedium size={15} aria-hidden="true" />
          <span>Solar</span>
          <small>{formatPower(displayedTelemetry.solarPowerKw)}</small>
        </div>
        <div
          className={`energy-source energy-source--battery energy-source--battery-${batteryState} energy-source--${
            flow.batterySuppliesCars || flow.solarChargesBattery ? "active" : "inactive"
          }`}
        >
          <BatteryCharging size={15} aria-hidden="true" />
          <span>Bateria</span>
          <small>
            {batterySoc === null ? "" : `${Math.round(batterySoc)}% · `}
            {formatPower(displayedTelemetry.batteryPowerKw)}
          </small>
        </div>
      </div>
    </section>
  );
}
