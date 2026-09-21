import type {EnergyFlowTelemetry} from './emps';
export type GieState = {
  online: boolean; station_id: string; mode: string; error?: string; observed_at: string;
  presentation?: {scene_number:number;name:string;playing:boolean};
  manual_events?: Record<string,string>;
  context?: {demands:Array<{charger_id:string;evse_slot:number;connected:boolean}>};
  state: null | {execution_allowed:boolean; numeric_state:Record<string,number | number[] | null>;
    visual_state:Record<string,unknown>; flows:Record<string,number>; primary_message?:{title:string;text:string}};
};
export function energyFromGie(gie:GieState):EnergyFlowTelemetry {
  const valid=gie.online && !!gie.state?.execution_allowed && gie.state?.visual_state.valid===true;
  const n=valid?gie.state!.numeric_state:{};const v=valid?gie.state!.visual_state:{};const f=valid?gie.state!.flows:{};
  const num=(key:string)=>typeof n[key]==='number'?n[key] as number:null;
  return {batteryMode:valid?v.battery_flow as EnergyFlowTelemetry['batteryMode']:'unknown',
    batteryPowerKw:valid?(num('battery_charge_kw')??0)+(num('battery_discharge_kw')??0):null,
    buildingPowerKw:num('building_kw'),batterySocPercent:num('battery_soc_pct'),chargerPowerKw:num('ev_served_kw'),
    gridPowerKw:valid?(num('grid_import_kw')??0)-(num('grid_export_kw')??0):null,
    solarPowerKw:num('solar_kw'),solarChargingBattery:valid&&(f.solar_to_battery_kw??0)>0,
    chargerSources:valid?[...((f.battery_to_ev_kw??0)>0?['battery' as const]:[]),...((f.grid_to_ev_kw??0)>0?['grid' as const]:[]),...((f.solar_to_ev_kw??0)>0?['solar' as const]:[])]:[],
    updatedAt:gie.observed_at,gieVisual:valid?v:{valid:false}};
}
