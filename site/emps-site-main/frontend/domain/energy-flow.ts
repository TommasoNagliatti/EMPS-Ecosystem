import type { Charger, EnergyFlowTelemetry } from "./emps";

export type EnergySimulationSettings = {
  period: "day" | "night";
  batterySocPercent: number;
  solarPowerKw: number;
};

function positivePower(value: number | null) {
  return value !== null && Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function batteryLevel(value: number | null) {
  return value !== null && Number.isFinite(value)
    ? Math.min(100, Math.max(0, value))
    : null;
}

export function simulateEnergyFlow(
  chargers: Charger[],
  settings: EnergySimulationSettings,
): EnergyFlowTelemetry {
  const occupied = chargers.filter((charger) => charger.status === "em_uso");
  const demandKw = occupied.reduce((total, charger) => {
    const maximumKw = positivePower(charger.potenciaMaximaKw) || 7.4;
    const powerKw = positivePower(charger.potenciaAtualKw)
      || Math.min(maximumKw, Math.max(3.7, maximumKw * 0.72));
    return total + powerKw;
  }, 0);
  const soc = batteryLevel(settings.batterySocPercent) ?? 0;
  const batterySuppliesCars = occupied.length > 0 && soc > 0;
  const gridSuppliesCars = occupied.length > 0 && !batterySuppliesCars;
  const batteryOutputKw = batterySuppliesCars ? demandKw : 0;
  const availableSolarKw = settings.period === "day" ? positivePower(settings.solarPowerKw) : 0;
  const solarKw = soc < 100 ? availableSolarKw : Math.min(availableSolarKw, batteryOutputKw);
  const netBatteryKw = solarKw - batteryOutputKw;

  // Solar is stored; the grid feeds only cars. The battery display shows net flow.
  return {
    batteryMode: netBatteryKw > 0.01 ? "charging" : netBatteryKw < -0.01 ? "discharging" : "idle",
    batteryPowerKw: Math.abs(netBatteryKw),
    batterySocPercent: soc,
    chargerPowerKw: demandKw,
    chargerSources: batterySuppliesCars ? ["battery"] : gridSuppliesCars ? ["grid"] : [],
    gridPowerKw: gridSuppliesCars ? demandKw : 0,
    solarChargingBattery: solarKw > 0,
    solarPowerKw: solarKw,
    updatedAt: null,
  };
}

export function getEnergyFlowState(chargers: Charger[], telemetry: EnergyFlowTelemetry) {
  if (telemetry.gieVisual) {
    const v=telemetry.gieVisual;const valid=v.valid===true;
    const active=[1,2,3,4].map(i=>valid && v['evse_'+i+'_active']===true);
    return {occupiedCount:active.filter(Boolean).length,batterySoc:batteryLevel(telemetry.batterySocPercent),batteryMode:telemetry.batteryMode,
      batterySuppliesCars:valid&&telemetry.chargerSources.includes('battery'),gridSuppliesCars:valid&&(v.grid_importing===true||v.grid_exporting===true),
      solarChargesBattery:valid&&v.solar_active===true,supplyingCars:active.some(Boolean),leftActive:active[0]||active[2],rightActive:active[1]||active[3]};
  }
  const occupiedIndices = chargers.flatMap((charger, index) =>
    charger.status === "em_uso" ? [index] : [],
  );
  const occupiedCount = occupiedIndices.length;
  const soc = batteryLevel(telemetry.batterySocPercent);
  const batterySuppliesCars = occupiedCount > 0 && soc !== 0
    && telemetry.chargerSources.includes("battery");
  const gridSuppliesCars = occupiedCount > 0 && telemetry.chargerSources.includes("grid");
  const solarChargesBattery = telemetry.solarChargingBattery
    && positivePower(telemetry.solarPowerKw) > 0;
  const supplyingCars = batterySuppliesCars || gridSuppliesCars;

  // The two pumps illustrate the whole station, including fleets with more than two chargers.
  return {
    occupiedCount,
    batterySoc: soc,
    batteryMode: telemetry.batteryMode,
    batterySuppliesCars,
    gridSuppliesCars,
    solarChargesBattery,
    supplyingCars,
    leftActive: supplyingCars && (occupiedCount >= 2 || occupiedIndices[0] % 2 === 0),
    rightActive: supplyingCars && (occupiedCount >= 2 || occupiedIndices[0] % 2 === 1),
  };
}
