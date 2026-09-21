"use client";

import { FlaskConical, Moon, SunMedium } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { EnergySimulationSettings } from "@/domain/energy-flow";

export function EnergySimulationControls({ settings, onChange }: {
  settings: EnergySimulationSettings;
  onChange: (settings: EnergySimulationSettings) => void;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div className="energy-simulation" ref={container}>
      <button
        aria-controls={open ? id : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Simular energia"
        className="energy-simulation__trigger"
        onClick={() => setOpen(!open)}
        ref={trigger}
        title="Simular energia"
        type="button"
      >
        <FlaskConical size={16} aria-hidden="true" />
      </button>
      {open && (
        <div className="energy-simulation__panel" role="dialog" aria-label="Simulacao de energia" id={id}>
          <strong>Simulacao</strong>
          <div className="energy-simulation__period" role="group" aria-label="Periodo">
            <button type="button" aria-pressed={settings.period === "day"} onClick={() => onChange({ ...settings, period: "day" })}>
              <SunMedium size={14} aria-hidden="true" /> Dia
            </button>
            <button type="button" aria-pressed={settings.period === "night"} onClick={() => onChange({ ...settings, period: "night" })}>
              <Moon size={14} aria-hidden="true" /> Noite
            </button>
          </div>
          <label className="energy-simulation__level">
            <span>Carga da bateria <output>{Math.round(settings.batterySocPercent)}%</output></span>
            <input
              aria-label="Carga da bateria"
              type="range"
              min="0"
              max="100"
              step="1"
              value={settings.batterySocPercent}
              onChange={(event) => onChange({ ...settings, batterySocPercent: Number(event.target.value) })}
            />
          </label>
          {settings.period === "day" && (
            <label className="energy-simulation__power">
              Solar (kW)
              <input
                type="number"
                min="0"
                max="200"
                step="0.5"
                value={settings.solarPowerKw}
                onChange={(event) => onChange({ ...settings, solarPowerKw: Math.min(200, Math.max(0, Number(event.target.value))) })}
              />
            </label>
          )}
        </div>
      )}
    </div>
  );
}
