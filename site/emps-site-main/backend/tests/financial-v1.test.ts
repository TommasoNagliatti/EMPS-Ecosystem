import test from 'node:test';
import assert from 'node:assert/strict';
import {validate} from 'class-validator';
import {CashSettlementDto} from '../src/dtos';
import {PaymentGatewayService} from '../src/payment-gateway.service';
import {AdminOperationsService} from '../src/admin-operations.service';
import {SessionBillingService} from '../src/session-billing.service';
import {GieService} from '../src/gie.service';
import {calculateSession,TARIFF_VERSION} from '../src/tariff-engine';

test('caixa aceita as quatro casas de energia oficiais e rejeita precisão extra',async()=>{
 const input=Object.assign(new CashSettlementDto(),{energiaConsumidaKwh:.1234,valorCobrado:.25,valorRecebido:.25,origem:'caixa'});
 assert.equal((await validate(input)).length,0);input.energiaConsumidaKwh=.12345;assert.ok((await validate(input)).some(e=>e.property==='energiaConsumidaKwh'));
});
test('Stripe recusa chave live e não eleva silenciosamente um total abaixo do mínimo',async()=>{
 const saved={key:process.env.STRIPE_SECRET_KEY,mode:process.env.PAYMENT_PROVIDER};
 try{
  process.env.PAYMENT_PROVIDER='stripe';process.env.STRIPE_SECRET_KEY='sk_live_test_fixture';assert.throws(()=>new PaymentGatewayService(),/chave de teste/);
  process.env.STRIPE_SECRET_KEY='sk_test_fixture';const g=new PaymentGatewayService();
  await assert.rejects(g.createSessionIntent({amount:'0.49',sessionId:'1',internalIntentId:'2',chargerId:'50',stationId:'13'}),/total oficial não foi alterado/);
 }finally{for(const [k,v] of Object.entries({STRIPE_SECRET_KEY:saved.key,PAYMENT_PROVIDER:saved.mode})){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
test('aprovação administrativa não substitui webhook Stripe',async()=>{
 const service=Object.create(AdminOperationsService.prototype) as any;
 service.prisma={payment:{findUnique:async()=>({id:1n,status:'PENDING',provider:'stripe'})}};
 await assert.rejects(service.approvePayment('1'),/confirmação assinada/);
});
test('cotação congelada permanece igual e não expõe rateio interno ao motorista',async()=>{
 const breakdown=calculateSession('10',[], '2026-09-19T12:00:00Z','2026-09-19T12:16:00Z');
 const row={id:10n,clientId:1,tariffVersion:TARIFF_VERSION,billingSnapshot:{tariff_version:TARIFF_VERSION,phase:'frozen',breakdown},status:'WAITING_PAYMENT',paymentIntent:{provider:'stripe'},disconnectedAt:new Date('2026-09-19T12:16:00Z')};
 const service=new SessionBillingService({user:{findUnique:async()=>({id:1,accountStatus:'ACTIVE'})},chargingSession:{findFirst:async()=>row}} as any,{} as any,{} as any);
 const one=await service.quote('1','10'),two=await service.quote('1','10');assert.deepEqual(one,two);assert.equal(one.breakdown.customer.overstay_fee,'0.25');assert.equal('internal_settlement_reference' in one.breakdown,false);
});
test('ativação V1 não avança ledger, energia ou valor de sessão histórica aberta',async()=>{
 const keys=['GIE_STATION_ID','GIE_SERVICE_URL','GIE_SERVICE_TOKEN','TARIFF_V1_STATION_IDS','TARIFF_V1_ACTIVATED_AT','OCPP_GATEWAY_URL'],saved=Object.fromEntries(keys.map(k=>[k,process.env[k]])),oldFetch=globalThis.fetch;
 Object.assign(process.env,{GIE_STATION_ID:'13',GIE_SERVICE_URL:'http://gie.test',GIE_SERVICE_TOKEN:'fixture',TARIFF_V1_STATION_IDS:'13',TARIFF_V1_ACTIVATED_AT:'2026-09-19T18:43:02Z',OCPP_GATEWAY_URL:''});
 const session={id:64n,status:'ACTIVE',requestedAt:new Date('2026-09-19T01:00:00Z'),tariffVersion:null};let writes=0;
 const db:any={gieEvseMapping:{findMany:async()=>[{stationId:13,chargerId:49,evseSlot:1,chargers:{sessions:[session],powerKw:22}}]},$queryRaw:async()=>[],chargingSession:{findFirst:async()=>session,update:async()=>{writes++}},chargerLiveStatus:{findUnique:async()=>({currentPowerKw:22}),update:async()=>{writes++}}};db.$transaction=async(fn:any)=>fn(db);
 globalThis.fetch=async()=>new Response(JSON.stringify({station_id:'13',mode:'NORMAL',state:{execution_allowed:true,provenance:{normal_demo:true},numeric_state:{evse_setpoints_kw:[22,0,0,0]}}}));
 try{const service=new GieService(db,{publish:()=>{}} as any);assert.equal((await service.refresh()).online,true);assert.equal(writes,0);}finally{globalThis.fetch=oldFetch;for(const k of keys){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}}
});
