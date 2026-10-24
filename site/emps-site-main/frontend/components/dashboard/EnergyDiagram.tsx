'use client';

import { BatteryCharging, Building2, Cable, PlugZap, Sun, UtilityPole } from 'lucide-react';
import type { EnergyFlowTelemetry } from '@/domain/emps';
import styles from './station-dashboard.module.css';

const value = (number: number | null | undefined) => number == null ? '--' : number.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
export function EnergyDiagram({ telemetry, noBattery = false }: { telemetry: EnergyFlowTelemetry | null | undefined; noBattery?: boolean }) {
  const t = telemetry;
  const nodes = [
    { key: 'solar', label: 'Solar', power: t?.solarPowerKw, Icon: Sun, x: 50, y: 17, color: '#d3ab32' },
    { key: 'grid', label: 'Rede', power: t?.gridPowerKw, Icon: UtilityPole, x: 15, y: 47, color: '#4395c8' },
    { key: 'load', label: 'Prédio', power: t?.buildingPowerKw, Icon: Building2, x: 85, y: 47, color: '#a57bd3' },
    { key: 'battery', label: 'Bateria', power: noBattery ? null : t?.batteryPowerKw, Icon: BatteryCharging, x: 50, y: 80, color: '#69b75e' },
    { key: 'charger', label: 'Carregadores', power: t?.chargerPowerKw, Icon: PlugZap, x: 85, y: 80, color: '#ef8e5b' },
  ];
  const paths = [
    { key: 'solar', d: 'M 500 134 V 235', active: (t?.solarPowerKw ?? 0) > 0, reverse: false, color: '#d3ab32' },
    { key: 'grid', d: 'M 212 235 H 465', active: Math.abs(t?.gridPowerKw ?? 0) > 0, reverse: (t?.gridPowerKw ?? 0) < 0, color: '#4395c8' },
    { key: 'load', d: 'M 535 235 H 788', active: (t?.buildingPowerKw ?? 0) > 0, reverse: false, color: '#a57bd3' },
    { key: 'battery', d: 'M 500 360 V 270', active: !noBattery && (t?.batteryPowerKw ?? 0) > 0, reverse: t?.batteryMode === 'charging', color: '#69b75e' },
    { key: 'charger', d: 'M 535 235 H 665 V 400 H 788', active: (t?.chargerPowerKw ?? 0) > 0, reverse: false, color: '#ef8e5b' },
  ];
  return <div className={styles.diagram} role="img" aria-label={noBattery ? 'Diagrama de energia: solar, rede, prédio e carregadores; sem bateria instalada' : 'Diagrama de energia: solar, rede, bateria e prédio conectados ao inversor e aos carregadores'}>
    <svg viewBox="0 0 1000 500" preserveAspectRatio="none" aria-hidden="true">{paths.map(path => <g key={path.key}><path d={path.d} fill="none" stroke="var(--monitor-border)" strokeWidth="2" /><path className={path.active ? styles.flowPath : ''} d={path.d} fill="none" stroke={path.active ? path.color : 'transparent'} strokeWidth="3" strokeDasharray="9 15" style={{ animationDirection: path.reverse ? 'reverse' : 'normal' }} /></g>)}</svg>
    <div className={styles.inverter} title="Inversor"><Cable size={22} /><span>Inversor</span></div>
    {nodes.map(({ key, label, power, Icon, x, y, color }) => <div className={styles.energyNode} key={key} style={{ left: `${x}%`, top: `${y}%`, borderColor: power ? color : undefined }}>
      {key === 'battery' && <span className={styles.soc}>{noBattery ? '—' : `${value(t?.batterySocPercent)}%`}</span>}<Icon size={25} style={{ color }} /><span>{label}</span><strong title={key === 'battery' && noBattery ? 'Sem bateria instalada' : undefined}>{key === 'battery' && noBattery ? '—' : value(power)} {!(key === 'battery' && noBattery) && <small>kW</small>}</strong>
    </div>)}
  </div>;
}
