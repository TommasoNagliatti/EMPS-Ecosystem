import {BadRequestException} from '@nestjs/common';
import {DataProvenance} from '@prisma/client';
export const telemetryFields={grid_power_kw:'gridPowerKw',solar_power_kw:'solarPowerKw',battery_power_kw:'batteryPowerKw',charger_power_kw:'chargerPowerKw',charger_requested_power_kw:'chargerRequestedPowerKw',building_power_kw:'buildingPowerKw',outside_temperature_c:'outsideTemperatureC',relative_humidity_percent:'relativeHumidityPercent',connected_vehicle_count:'connectedVehicleCount',queued_vehicle_count:'queuedVehicleCount',battery_soc_percent:'batteryStateOfChargePercent'} as const;
export const intervalFields={occupied_chargers:'occupiedChargers',arriving_cars:'arrivingCars',occupancy_percent:'occupancyPercent',delivered_energy_kwh:'deliveredEnergyKwh'} as const;
export type TelemetryInput={timestamp:string;[key:string]:unknown};
export function validateReading(row:TelemetryInput,kind:DataProvenance,now=new Date()){
 if(!row||typeof row.timestamp!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(row.timestamp))throw new BadRequestException('Timestamp ISO com offset obrigatório');
 const at=new Date(row.timestamp);if(!Number.isFinite(at.getTime())||at.getTime()>now.getTime()+(kind==='FORECAST'?30*86400000:300000))throw new BadRequestException('Timestamp inválido ou futuro para esta origem');
 const data:Record<string,number>={};
 for(const [key,value] of Object.entries(row)){
  if(key==='timestamp')continue;
  if(!Object.hasOwn(telemetryFields,key)&&!Object.hasOwn(intervalFields,key))throw new BadRequestException('Coluna não reconhecida: '+key);
  if(value===null||value===undefined||(typeof value==='string'&&value.trim()===''))continue;
  if(typeof value!=='number'&&typeof value!=='string')throw new BadRequestException('Valor inválido: '+key);
  const number=Number(value);if(!Number.isFinite(number))throw new BadRequestException('Valor não finito: '+key);
  const signed=['grid_power_kw','battery_power_kw'].includes(key),temperature=key==='outside_temperature_c',percent=key.endsWith('_percent'),count=key.endsWith('_count')||['occupied_chargers','arriving_cars'].includes(key);
  if(number<(temperature?-100:signed?-1000000:0)||number>(temperature?100:percent?100:count?255:1000000)||(count&&!Number.isInteger(number)))throw new BadRequestException('Valor fora da faixa: '+key);
  if(Object.hasOwn(telemetryFields,key))data[telemetryFields[key as keyof typeof telemetryFields]]=number;
 }
 if(!Object.keys(data).length)throw new BadRequestException('Informe ao menos uma medida');
 let snapshot: {buildingPowerKw:number;outsideTemperatureC:number;relativeHumidityPercent:number;requestedPowerKw:number;deliveredPowerKw:number;occupiedChargers:number;connectedCars:number;arrivingCars:number;queuedCars:number;occupancyPercent:number;deliveredEnergyKwh:number}|undefined;
 if(Object.keys(intervalFields).some(k=>row[k]!==undefined)){
  const required=['building_power_kw','outside_temperature_c','relative_humidity_percent','charger_requested_power_kw','charger_power_kw','connected_vehicle_count','queued_vehicle_count',...Object.keys(intervalFields)];
  if(required.some(k=>row[k]===null||row[k]===undefined||row[k]==='')||at.getTime()%900000!==0)throw new BadRequestException('Snapshot GIE exige todas as variáveis do intervalo de 15 minutos');
  if(Number(row.charger_power_kw)>Number(row.charger_requested_power_kw)+.001||Math.abs(Number(row.delivered_energy_kwh)-Number(row.charger_power_kw)*.25)>.005)throw new BadRequestException('Energia/potência do intervalo incoerentes');
  snapshot={buildingPowerKw:Number(row.building_power_kw),outsideTemperatureC:Number(row.outside_temperature_c),relativeHumidityPercent:Number(row.relative_humidity_percent),requestedPowerKw:Number(row.charger_requested_power_kw),deliveredPowerKw:Number(row.charger_power_kw),occupiedChargers:Number(row.occupied_chargers),connectedCars:Number(row.connected_vehicle_count),arrivingCars:Number(row.arriving_cars),queuedCars:Number(row.queued_vehicle_count),occupancyPercent:Number(row.occupancy_percent),deliveredEnergyKwh:Number(row.delivered_energy_kwh)};
 }
 return {measuredAt:at,data,snapshot};
}
export function dataWindow(from:string,to:string){const a=new Date(from),b=new Date(to);if(!Number.isFinite(a.getTime())||!Number.isFinite(b.getTime())||b<=a||b.getTime()-a.getTime()>731*86400000)throw new BadRequestException('Período inválido; máximo 24 meses');return {gte:a,lt:b}}
export const physicalSourceWhere={provenance:'MEASURED' as const,source:{is:{kind:'MEASURED',verifiedPhysical:true,verifiedBy:{not:null}}}};
export const consumptionColumns=['buildingPowerKw','outsideTemperatureC','relativeHumidityPercent'] as const;
export function longestRun(times:number[]){let longest=0,run=0,previous:number|undefined;for(const time of times){run=previous!==undefined&&time-previous===900000?run+1:1;previous=time;longest=Math.max(longest,run)}return longest}
export function datasetRows(rows:any[]){
 const slots=new Map<number,any[]>();for(const row of rows){const time=row.measuredAt.getTime();if(time%900000!==0)continue;const list=slots.get(time)??[];list.push(row);slots.set(time,list)}
 return [...slots.entries()].sort((a,b)=>a[0]-b[0]).filter(([,list])=>list.length===1&&consumptionColumns.every(k=>list[0][k]!==null)).map(([time,[row]])=>({station_id:row.stationId,timestamp:new Date(time).toISOString(),consumo_predio_kw:Number(row.buildingPowerKw),temperatura_externa_c:Number(row.outsideTemperatureC),umidade_relativa_pct:Number(row.relativeHumidityPercent),provenance:row.provenance,source_id:row.sourceId,import_batch_id:row.importBatchId,available_at:new Date(time+900000).toISOString()}));
}
