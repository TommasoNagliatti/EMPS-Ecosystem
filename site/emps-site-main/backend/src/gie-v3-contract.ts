/** The Python service is a separate trust boundary. Keep its wire contract explicit. */
export type GieV3Health = {
  station_id: string;
  status: 'running' | 'stopped' | 'failed';
  generation: string | null;
  physical_dispatch: false;
  error?: string | null;
};

export type GieV3State = {
  station_id: string;
  schema_version: '1.0';
  generation: string;
  revision: number;
  mode: 'NORMAL' | 'SIMULATION' | 'PRESENTATION' | 'MANUAL_DEMO';
  state: Record<string, unknown> | null;
  capabilities: { forecasts: boolean; mpc_demo: boolean; physical_dispatch: false; load_balancer: boolean; presentation: boolean; manual_demo: boolean };
  source: 'SIMULATED';
  hardware_commands_sent: false;
  history: {station_id:string;issue_time:string;origin:'SIMULATED';status:string}[];
  simulation_state?: Record<string, unknown> | null;
  [key: string]: unknown;
};

export type GieV3Provision = {
  schema_version: '1.0'; station_id: string; timezone: string;
  import_kw: number; export_kw: number;
  chargers: {evse_id: string; max_kw: number; minimum_kw: number; available: boolean}[];
  batteries: {battery_id: string; capacity_kwh: number; soc_initial: number; soc_min: number; soc_max: number; charge_kw: number; discharge_kw: number; eta_charge: number; eta_discharge: number; inverter_id: string; available: boolean}[];
  solar: {solar_id: string; inverter_id: string; dc_kwp: number; available: boolean}[];
  inverters: {inverter_id: string; ac_kw: number; available: boolean}[];
  circuits: {circuit_id: string; evse_ids: string[]; max_kw: number}[];
  policy: 'solar_only_lex_v3.0' | 'grid_allowed_lex_v3.0';
  training_state: 'BASELINE'; baseline_building_kw: number | null; origin: 'SIMULATED';
};

export type GieV3Event = {
  cursor: number; schema_version: '1.0'; event_id: string; alert_id: string;
  station_id: string; emitted_at: string;
  transition: 'CREATED' | 'UPDATED' | 'REOPENED' | 'ACKNOWLEDGED' | 'RESOLVED';
  alert: { alert_id: string; station_id: string; generation: string | null; revision: number; code: string; title: string; description: string; severity: 'info' | 'warning' | 'error' | 'critical'; status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED'; timestamp: string; equipment_id?: string | null; provenance: {origin: 'SIMULATED'; [key: string]: unknown}; [key: string]: unknown };
  physical_dispatch: false; hardware_commands_sent: false;
};

function obj(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Resposta GIE inválida');
  return value as Record<string, unknown>;
}
function identity(value: unknown, expected: string) {
  if (value !== expected) throw new Error('Identidade GIE divergente');
}
function text(value: unknown) { return typeof value === 'string' && value.length > 0; }
function date(value: unknown) { return text(value) && Number.isFinite(Date.parse(value as string)); }

export function parseGieV3Health(value: unknown, expected: string): GieV3Health {
  const h = obj(value); identity(h.station_id, expected);
  if (!['running','stopped','failed'].includes(String(h.status)) || (h.generation !== null && h.generation !== undefined && !text(h.generation)) || h.physical_dispatch !== false)
    throw new Error('Health GIE inválido');
  return h as GieV3Health;
}

export function parseGieV3State(value: unknown, expected: string): GieV3State {
  const s = obj(value); identity(s.station_id, expected);
  const c = obj(s.capabilities);
  if (s.schema_version !== '1.0' || !text(s.generation) || !Number.isSafeInteger(s.revision) ||
      !['NORMAL','SIMULATION','PRESENTATION','MANUAL_DEMO'].includes(String(s.mode)) ||
      (s.state !== null && (typeof s.state !== 'object' || Array.isArray(s.state))) ||
      s.source !== 'SIMULATED' || s.hardware_commands_sent !== false ||
      (s.physical_dispatch !== undefined && s.physical_dispatch !== false) || c.physical_dispatch !== false ||
      !['forecasts','mpc_demo','load_balancer','presentation','manual_demo'].every(k => typeof c[k] === 'boolean'))
    throw new Error('Estado GIE inválido');
  if(!Array.isArray(s.history)||s.history.length>100||s.history.some(raw=>{
    const h=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:null;
    return !h||h.station_id!==expected||h.origin!=='SIMULATED'||!text(h.status)||
      !date(h.issue_time)||!/[+-]\d\d:\d\d$|Z$/.test(String(h.issue_time));
  }))throw new Error('Histórico GIE inválido ou pertencente a outra estação');
  if (s.state !== null) {
    const decision = obj(s.state), provenance = obj(decision.provenance);
    const extension = decision.station_extension === undefined ? null : obj(decision.station_extension);
    if (typeof decision.execution_allowed !== 'boolean' || provenance.origin !== 'SIMULATED' ||
        provenance.station_id !== expected ||
        (extension && (extension.station_id !== expected || extension.physical_dispatch !== false)))
      throw new Error('Decisão GIE inválida ou pertencente a outra estação');
  }
  return s as GieV3State;
}

export function parseGieV3Events(value: unknown, expected: string, after: number): GieV3Event[] {
  if (!Array.isArray(value) || value.length > 500) throw new Error('Eventos GIE inválidos');
  let cursor = after;
  return value.map(raw => {
    const e = obj(raw), a = obj(e.alert), provenance = obj(a.provenance);
    identity(e.station_id, expected); identity(a.station_id, expected);
    if (e.schema_version !== '1.0' || !text(e.event_id) || !text(e.alert_id) || e.alert_id !== a.alert_id ||
        !Number.isSafeInteger(e.cursor) || Number(e.cursor) <= cursor || !date(e.emitted_at) ||
        !['CREATED','UPDATED','REOPENED','ACKNOWLEDGED','RESOLVED'].includes(String(e.transition)) ||
        !Number.isSafeInteger(a.revision) || Number(a.revision) < 1 || !text(a.code) || !text(a.title) ||
        !text(a.description) || !date(a.timestamp) || !['info','warning','error','critical'].includes(String(a.severity)) ||
        !['OPEN','ACKNOWLEDGED','RESOLVED'].includes(String(a.status)) || provenance.origin !== 'SIMULATED' ||
        e.physical_dispatch !== false || e.hardware_commands_sent !== false)
      throw new Error('Evento GIE inválido');
    cursor = Number(e.cursor);
    return e as GieV3Event;
  });
}
