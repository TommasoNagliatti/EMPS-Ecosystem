import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export function isGieDemoProfile(profile:string|null|undefined){return profile==='POSTO'||profile==='CASA';}

/** A V3 simulation never supplies billable meter energy. Charging admission calls this under the station row lock. */
export async function assertGieV3ChargingMeter(tx:Prisma.TransactionClient,stationId:number){
  const binding=await tx.gieStationBinding?.findUnique({where:{stationId}});
  if(!binding)return;
  if(isGieDemoProfile(binding.profile))
    throw new ConflictException('Instalação GIE demonstrativa não aceita recargas ou pagamentos');
  if(!process.env.OCPP_GATEWAY_URL||!process.env.OCPP_GATEWAY_TOKEN)
    throw new ConflictException('Recarga nesta instalação exige caminho de medição OCPP validado; GIE simulado não fornece energia faturável');
}
