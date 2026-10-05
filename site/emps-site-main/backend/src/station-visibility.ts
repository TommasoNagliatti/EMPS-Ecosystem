import { Prisma } from '@prisma/client';

/** Eligibility for driver APIs, distinct from administrative station access. */
export function eligibleStationWhere(userId?:number, now=new Date()):Prisma.StationWhereInput {
  return {status:'ACTIVE',AND:[
    {OR:[{reviewState:null},{reviewState:'APPROVED'}]},
    {OR:[{visibility:'PUBLIC'},...(userId ? [
      {adminId:userId}, {staff:{some:{userId}}},
      {rfidCredentials:{some:{userId,enabled:true,OR:[{expiresAt:null},{expiresAt:{gt:now}}]}}},
    ]:[])]},
  ]};
}
