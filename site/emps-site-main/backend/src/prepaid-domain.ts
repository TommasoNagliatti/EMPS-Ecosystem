import {BadRequestException,ConflictException} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import { BUDGET_RESERVE_SECONDS } from './charge-lifecycle';
import {assertChargeRuntimeStation} from './charge-runtime';
import {backgroundJobsEnabled} from './remote-development';
export function assertPrepaidRuntime(stationId:number){
 assertChargeRuntimeStation(stationId);
 if(!backgroundJobsEnabled())throw new ConflictException('Monitor de orcamento inativo; recarga limitada nao pode iniciar');
}
export function prepaidMargin(power:Prisma.Decimal.Value,rate:Prisma.Decimal.Value){return Prisma.Decimal.max('0.05',new Prisma.Decimal(power).mul(20).div(3600).mul(rate))}
export function lifecycleBudgetMargin(power:Prisma.Decimal.Value,rate:Prisma.Decimal.Value){return Prisma.Decimal.max('0.05',new Prisma.Decimal(power).mul(BUDGET_RESERVE_SECONDS).div(3600).mul(rate).add('0.01'))}
export function assertLifecycleBudget(limit:Prisma.Decimal.Value,power:Prisma.Decimal.Value|null,rate:Prisma.Decimal.Value,fee:Prisma.Decimal.Value){
 if(power===null||!new Prisma.Decimal(power).isFinite()||new Prisma.Decimal(power).lte(0))throw new BadRequestException('Potencia maxima do carregador nao configurada');
 const minimum=lifecycleBudgetMargin(power,rate).add(fee).add('0.01').toDecimalPlaces(2,Prisma.Decimal.ROUND_UP);
 if(new Prisma.Decimal(limit).lt(minimum))throw new BadRequestException(`Autorize ao menos R$ ${minimum.toFixed(2)} para a parada segura`);
}
export function assertPrepaidAmount(limit:number,power:Prisma.Decimal.Value|null,rate:Prisma.Decimal.Value,fee:Prisma.Decimal.Value){
 if(power===null||new Prisma.Decimal(power).lte(0))throw new BadRequestException('Potência do carregador não configurada');
 const minimum=prepaidMargin(power,rate).add(fee).add('0.01').toDecimalPlaces(2,Prisma.Decimal.ROUND_UP);
 if(new Prisma.Decimal(limit).lt(minimum))throw new BadRequestException(`Autorize ao menos R$ ${minimum.toFixed(2)} para este carregador`);
}
