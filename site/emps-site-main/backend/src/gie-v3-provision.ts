import { BadRequestException } from '@nestjs/common';
import type { GieV3Provision } from './gie-v3-contract';

type NumberLike = number | string | {toString(): string} | null | undefined;
type Battery = {id:string; capacityKwh:NumberLike; maxChargeKw:NumberLike; maxDischargeKw:NumberLike; socPercent:NumberLike; minSocPercent:NumberLike; maxSocPercent:NumberLike; efficiency:NumberLike; status:string};
type Solar = {id:string; installedKwp:NumberLike; acPowerKw:NumberLike; status:string};
type Charger = {ocppIdentity:string; powerKw:NumberLike; configuredPowerLimitKw:NumberLike; administrativeStatus:string};
export type ApprovedGieStation = {id:number; timezone:string; powerLimitKw:NumberLike; gieProvisioning:unknown; batteries:Battery[]; solarAssets:Solar[]; chargers:Charger[]};

type Technical = {exportKw?:unknown; baselineBuildingKw?:unknown; policy?:unknown;
  inverters?:{inverterId:string; acKw:number; available?:boolean}[];
  solarInverters?:Record<string,string>; batteryInverters?:Record<string,string>;
  circuits?:{circuitId:string; evseIds:string[]; maxKw:number}[]};

function number(value:NumberLike,field:string,min:number,max:number):number {
  const n=value===null||value===undefined||value===''?NaN:Number(value);
  if(!Number.isFinite(n)||n<min||n>max)throw new BadRequestException(`Configuração GIE inválida: ${field}`);
  return n;
}
function fraction(value:NumberLike,field:string){return number(value,field,0,100)/100;}
function unique(ids:string[],field:string){if(ids.some(id=>!id||id.length>64)||new Set(ids).size!==ids.length)throw new BadRequestException(`Identidades GIE inválidas: ${field}`);}
function technical(value:unknown):Technical {
  if(!value||typeof value!=='object'||Array.isArray(value))return {};
  const root=value as Record<string,unknown>;
  const v3=root.v3Technical;
  return v3&&typeof v3==='object'&&!Array.isArray(v3)?v3 as Technical:{};
}

/** Converts approved EMPS configuration; absent measurements stay absent. */
export function buildGieV3Provision(station:ApprovedGieStation):GieV3Provision {
  const t=technical(station.gieProvisioning);
  const importKw=number(station.powerLimitKw,'import_kw',0,100000);
  const activeChargers=station.chargers.filter(c=>c.administrativeStatus!=='DISABLED');
  const chargers=activeChargers.map(c=>({
    evse_id:c.ocppIdentity,
    max_kw:number(c.configuredPowerLimitKw??c.powerKw,'charger.max_kw',0.001,1000),
    minimum_kw:0, available:c.administrativeStatus==='ENABLED',
  }));
  unique(chargers.map(c=>c.evse_id),'chargers');
  const activeSolar=station.solarAssets.filter(s=>s.status!=='INACTIVE');
  const activeBatteries=station.batteries.filter(b=>b.status!=='INACTIVE');
  if((activeSolar.length||activeBatteries.length)&&(!Array.isArray(t.inverters)||!t.inverters.length))
    throw new BadRequestException('Inversores aprovados são obrigatórios para solar/baterias');
  if(activeSolar.length&&t.exportKw===undefined)throw new BadRequestException('Limite de exportação aprovado é obrigatório');
  const inverters=(t.inverters??[]).map(i=>({inverter_id:i.inverterId,ac_kw:number(i.acKw,'inverter.ac_kw',0.001,10000),available:i.available!==false}));
  unique(inverters.map(i=>i.inverter_id),'inverters');
  const inverterIds=new Set(inverters.map(i=>i.inverter_id));
  const solar=activeSolar.map(s=>({solar_id:s.id,inverter_id:t.solarInverters?.[s.id]??'',dc_kwp:number(s.installedKwp,'solar.dc_kwp',0.001,10000),available:s.status!=='FAULTED'}));
  for(const asset of activeSolar){
    if(asset.acPowerKw===null||asset.acPowerKw===undefined)continue;
    const inverter=inverters.find(i=>i.inverter_id===t.solarInverters?.[asset.id]);
    if(inverter&&number(asset.acPowerKw,'solar.ac_kw',0.001,10000)>inverter.ac_kw+1e-9)
      throw new BadRequestException('Potência AC solar supera o inversor aprovado');
  }
  const batteries=activeBatteries.map(b=>({
    battery_id:b.id,capacity_kwh:number(b.capacityKwh,'battery.capacity_kwh',0.001,100000),
    soc_initial:fraction(b.socPercent,'battery.soc_initial'),soc_min:fraction(b.minSocPercent,'battery.soc_min'),soc_max:fraction(b.maxSocPercent,'battery.soc_max'),
    charge_kw:number(b.maxChargeKw,'battery.charge_kw',0,10000),discharge_kw:number(b.maxDischargeKw,'battery.discharge_kw',0,10000),
    // EMPS stores one per-direction efficiency; never interpret this as a percentage.
    eta_charge:number(b.efficiency,'battery.eta_charge',0.001,1),eta_discharge:number(b.efficiency,'battery.eta_discharge',0.001,1),
    inverter_id:t.batteryInverters?.[b.id]??'',available:b.status!=='FAULTED',
  }));
  if([...solar,...batteries].some(a=>!inverterIds.has(a.inverter_id)))throw new BadRequestException('Associação de inversor ausente ou inválida');
  if(batteries.some(b=>b.soc_min>=b.soc_max||b.soc_initial<b.soc_min||b.soc_initial>b.soc_max))throw new BadRequestException('Faixa SoC incompatível');
  const circuits=(t.circuits??[]).map(c=>({circuit_id:c.circuitId,evse_ids:c.evseIds,max_kw:number(c.maxKw,'circuit.max_kw',0,10000)}));
  unique(circuits.map(c=>c.circuit_id),'circuits');
  const evseIds=new Set(chargers.map(c=>c.evse_id));
  if(circuits.some(c=>!c.evse_ids.length||c.evse_ids.some(id=>!evseIds.has(id))))throw new BadRequestException('Circuito referencia EVSE inválido');
  if(t.policy!==undefined&&!['solar_only_lex_v3.0','grid_allowed_lex_v3.0'].includes(String(t.policy)))throw new BadRequestException('Política GIE inválida');
  return {
    schema_version:'1.0',station_id:`EMPS_${station.id}`,timezone:station.timezone,
    import_kw:importKw,export_kw:t.exportKw===undefined?0:number(t.exportKw as NumberLike,'export_kw',0,100000),
    chargers,batteries,solar,inverters,circuits,
    policy:(t.policy??'solar_only_lex_v3.0') as GieV3Provision['policy'],
    training_state:'BASELINE',baseline_building_kw:t.baselineBuildingKw===undefined?null:number(t.baselineBuildingKw as NumberLike,'baseline_building_kw',0,100000),
    origin:'SIMULATED',
  };
}
