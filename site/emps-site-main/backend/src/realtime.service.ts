import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Namespace } from 'socket.io';
import { REALTIME_CHANGE_EVENT, REALTIME_ROOMS, type RealtimeChange, type RealtimeChangeInput, type RealtimeCustomerChangeInput, type RealtimeOperationsChangeInput } from './realtime.contract';
import { createRealtimeChange } from './realtime.helpers';
import { PrismaService } from './prisma.service';

type Input=Omit<RealtimeChangeInput,'entityId'|'customerId'> & {entityId:string|number|bigint;customerId?:string|number};

@Injectable()
export class RealtimeService {
  private emitter?:Pick<Namespace,'to'>;
  private readonly pending=new Set<Promise<void>>();
  private readonly logger=new Logger(RealtimeService.name);
  constructor(@Inject(PrismaService) private readonly db:PrismaService){}
  attachEmitter(emitter:Pick<Namespace,'to'>){this.emitter=emitter}
  isReady(){return this.emitter!==undefined}
  async flush(){await Promise.all([...this.pending])}

  private async stationFor(input:Input):Promise<number|null>{
    if(input.stationId!==undefined){const n=Number(input.stationId);return Number.isSafeInteger(n)&&n>0?n:null}
    const id=String(input.entityId);
    if(!/^[1-9]\d*$/.test(id))return null;
    if(input.topic.startsWith('charger.') && Number(id)<=4294967295)
      return (await this.db.charger.findUnique({where:{id:Number(id)},select:{stationId:true}}))?.stationId??null;
    if(input.topic.startsWith('session.') && BigInt(id)<=18446744073709551615n)
      return (await this.db.chargingSession.findUnique({where:{id:BigInt(id)},select:{charger:{select:{stationId:true}}}}))?.charger.stationId??null;
    if(input.topic.startsWith('alert.') && BigInt(id)<=18446744073709551615n){
      const row=await this.db.alert.findUnique({where:{id:BigInt(id)},select:{stationId:true,charger:{select:{stationId:true}}}});
      return row?.stationId??row?.charger?.stationId??null;
    }
    // Old payment/station publishers may use session/command IDs.
    // Never infer an owning station from those ambiguous identifiers.
    return null;
  }
  private async deliver(input:Input,change:RealtimeChange){
    const rooms=new Set<string>();
    const stationId=await this.stationFor(input);
    if(stationId){
      // Recheck membership on delivery so removed members cannot retain access.
      const users=await this.db.user.findMany({where:{accountStatus:'ACTIVE',OR:[{stations:{some:{id:stationId}}},{stationStaff:{some:{stationId}}}]},select:{id:true}});
      users.forEach(u=>rooms.add(REALTIME_ROOMS.customer(String(u.id))));
      if(!input.operational && (input.topic==='charger.updated' || input.topic==='station.updated')){
        const publicStation=await this.db.station.findFirst({where:{id:stationId,status:'ACTIVE',visibility:'PUBLIC',OR:[{reviewState:null},{reviewState:'APPROVED'}]},select:{id:true}});
        if(publicStation)this.emitter?.to(REALTIME_ROOMS.authenticated).emit(REALTIME_CHANGE_EVENT,{...change,customerId:undefined});
      }
    }
    if(input.customerId!==undefined){
      const id=Number(input.customerId);
      if(Number.isSafeInteger(id)&&id>0 && await this.db.user.findFirst({where:{id,accountStatus:'ACTIVE'},select:{id:true}}))rooms.add(REALTIME_ROOMS.customer(String(id)));
    }
    if(rooms.size)this.emitter?.to([...rooms]).emit(REALTIME_CHANGE_EVENT,change);
  }
  publish(input:Input):RealtimeChange {
    const change=createRealtimeChange({...input,entityId:String(input.entityId),customerId:input.customerId===undefined?undefined:String(input.customerId)});
    if(this.emitter){
      const task=this.deliver(input,change).catch(()=>{this.logger.warn('Realtime delivery failed closed')});
      this.pending.add(task);void task.finally(()=>this.pending.delete(task));
    }
    return change;
  }
  publishToOperations(input:Omit<RealtimeOperationsChangeInput,'entityId'>&{entityId:string|number|bigint}){return this.publish({...input,operational:true})}
  publishToCustomer(customerId:string,input:RealtimeCustomerChangeInput){return this.publish({...input,customerId})}
}
