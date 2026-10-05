import {ForbiddenException} from '@nestjs/common';
export function chargeRuntimeStationIds(){
 const value=process.env.CHARGE_RUNTIME_STATION_IDS;
 if(value===undefined)return null;
 const ids=value.split(',').filter(v=>/^[1-9]\d*$/.test(v)).map(Number);
 return ids;
}
export function assertChargeRuntimeStation(stationId:number){
 const ids=chargeRuntimeStationIds();
 if(ids && !ids.includes(stationId))throw new ForbiddenException('Esta estação não permite operações neste ambiente de teste');
}
