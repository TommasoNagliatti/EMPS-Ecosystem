import assert from 'node:assert/strict';
import test from 'node:test';
import {DEFAULT_DEMO_SCENARIO,demoFinancials} from '../src/demo-history-finance';

test('demo values follow delivered energy and tariff, never a random price',()=>{
  const session={sourceSessionId:'S1',status:'COMPLETED' as const,deliveredEnergyKwh:'10.5000000000',endedAt:new Date('2025-01-01T12:00:00Z')};
  const result=demoFinancials(session,DEFAULT_DEMO_SCENARIO);
  assert.equal(result.amount,'23.10');assert.equal(result.costAmount,'8.40');
  assert.equal(result.payment?.amount,result.amount);
  assert.deepEqual(demoFinancials(session,DEFAULT_DEMO_SCENARIO),result);
  assert.ok(['APP_EMPS','WEB_CHARGE','CAIXA'].includes(result.payment!.channel));
  assert.ok(['PIX','CREDIT_CARD','DEBIT_CARD','CASH'].includes(result.payment!.method));
});

test('unserved and zero-energy attempts never get simulated receipts or positive fees',()=>{
  const endedAt=new Date('2025-01-01T12:00:00Z');
  for(const session of [
    {sourceSessionId:'S2',status:'UNSERVED' as const,deliveredEnergyKwh:'0',endedAt},
    {sourceSessionId:'S3',status:'COMPLETED' as const,deliveredEnergyKwh:'0',endedAt},
  ]){
    const value=demoFinancials(session,{...DEFAULT_DEMO_SCENARIO,fixedFee:'4.00'});
    assert.equal(value.amount,'0.00');assert.equal(value.payment,null);assert.equal(value.billable,false);
  }
});

test('channels and methods remain separate with reproducible, adjustable weights',()=>{
  const scenario={...DEFAULT_DEMO_SCENARIO,channelWeights:{APP_EMPS:0,WEB_CHARGE:0,CAIXA:1},
    methodWeights:{...DEFAULT_DEMO_SCENARIO.methodWeights,CAIXA:{CASH:1}}};
  const session={sourceSessionId:'S4',status:'COMPLETED' as const,deliveredEnergyKwh:'30',endedAt:new Date('2025-01-01T12:00:00Z')};
  const result=demoFinancials(session,scenario);
  assert.equal(result.amount,'66.00');assert.equal(result.payment?.channel,'CAIXA');assert.equal(result.payment?.method,'CASH');
  assert.equal(result.payment?.sourcePaymentId,demoFinancials(session,scenario).payment?.sourcePaymentId);
});
