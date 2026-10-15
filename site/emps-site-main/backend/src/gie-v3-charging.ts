import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/** A V3 simulation never supplies billable meter energy. Run under the station row lock. */
export async function assertGieV3ChargingMeter(tx:Prisma.TransactionClient,stationId:number){
  if(process.env.OCPP_GATEWAY_URL)return;
  if(await tx.gieStationBinding?.findUnique({where:{stationId}}))
    throw new ConflictException('Recarga nesta instalação exige caminho de medição OCPP validado; GIE simulado não fornece energia faturável');
}
