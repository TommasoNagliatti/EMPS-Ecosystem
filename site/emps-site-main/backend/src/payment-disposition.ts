import {Prisma} from '@prisma/client';

export function paymentDisposition(input:{method:string;provider:string;authorized:Prisma.Decimal.Value;consumed:Prisma.Decimal.Value;captured:Prisma.Decimal.Value}){
 const D=Prisma.Decimal,authorized=new D(input.authorized),consumed=new D(input.consumed),captured=new D(input.captured);
 const pix=input.method==='PIX',sandbox=input.provider==='sandbox',unused=D.max(0,authorized.sub(consumed));
 return {authorizedAmount:authorized.toFixed(2),consumedAmount:consumed.toFixed(2),capturedAmount:(pix&&sandbox?authorized:captured).toFixed(2),
  releasedAmount:pix?'0.00':D.max(0,authorized.sub(captured)).toFixed(2),refundDueAmount:pix?unused.toFixed(2):'0.00',
  refundedAmount:pix&&sandbox?unused.toFixed(2):'0.00',refundStatus:pix&&unused.gt(0)?sandbox?'SIMULATED':'PENDING_PROVIDER':'NOT_APPLICABLE',
  refundDestination:pix?'SAME_PAYMENT_METHOD':null,provenance:sandbox?'SIMULATED':'EXTERNAL',provider:input.provider};
}
export async function recordPaymentDisposition(tx:Prisma.TransactionClient,sessionId:bigint,details:ReturnType<typeof paymentDisposition>){
 const command=await tx.chargingCommand.findFirst({where:{sessionId,type:'STOP_CHARGING'},orderBy:{id:'desc'}});
 if(!command)return;
 const previous=command.responsePayload&&typeof command.responsePayload==='object'&&!Array.isArray(command.responsePayload)?command.responsePayload:{};
 await tx.chargingCommand.update({where:{id:command.id},data:{responsePayload:{...previous,paymentDisposition:details} as Prisma.InputJsonValue}});
}
