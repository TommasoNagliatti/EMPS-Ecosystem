import {BadRequestException} from '@nestjs/common';
import {Prisma} from '@prisma/client';
export function prepaidMargin(power:Prisma.Decimal.Value,rate:Prisma.Decimal.Value){return Prisma.Decimal.max('0.05',new Prisma.Decimal(power).mul(20).div(3600).mul(rate))}
export function assertPrepaidAmount(limit:number,power:Prisma.Decimal.Value|null,rate:Prisma.Decimal.Value,fee:Prisma.Decimal.Value){
 if(power===null||new Prisma.Decimal(power).lte(0))throw new BadRequestException('Potência do carregador não configurada');
 const minimum=prepaidMargin(power,rate).add(fee).add('0.01').toDecimalPlaces(2,Prisma.Decimal.ROUND_UP);
 if(new Prisma.Decimal(limit).lt(minimum))throw new BadRequestException(`Autorize ao menos R$ ${minimum.toFixed(2)} para este carregador`);
}
