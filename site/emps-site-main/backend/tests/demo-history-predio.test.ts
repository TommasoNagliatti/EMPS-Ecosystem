import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import test from 'node:test';
import {COMMERCIAL_SHARED_ENERGY_SHA256,COMMERCIAL_SHARED_SOURCE_GROUP,loadDemoDataset}
  from '../src/demo-history-datasets';
import {demoFinancials} from '../src/demo-history-finance';
import {PREDIO_FINANCIAL_SCENARIO,PREDIO_PAYMENT_QUOTAS,PREDIO_SUPPLIED_PACKAGE,
  predioPaymentAttributions} from '../src/demo-history-predio';

const source=resolve(__dirname,'../../../../gie/GIE/data');

test('Prédio reuses the exact GIE commercial events and intervals with separate station provenance',()=>{
  const shopping=loadDemoDataset('SHOPPING',source);
  const predio=loadDemoDataset('PREDIO',source);
  assert.notEqual(predio.datasetKey,shopping.datasetKey);
  assert.equal(predio.datasetSha256,shopping.datasetSha256);
  assert.equal(predio.sourceFiles.find(file=>file.relativePath==='demanda_carregadores_6_meses.csv')?.sha256,
    COMMERCIAL_SHARED_ENERGY_SHA256);
  assert.equal(PREDIO_SUPPLIED_PACKAGE.sharedSourceGroup,COMMERCIAL_SHARED_SOURCE_GROUP);
  assert.equal(predio.sessions.length,5477);
  assert.equal(predio.readings.length,17376);
  assert.deepEqual(predio.sessions.map(session=>session.sourceSessionId),
    shopping.sessions.map(session=>session.sourceSessionId));
  assert.deepEqual([...new Set(predio.sessions.map(session=>session.sourceChargerId).filter(Boolean))].sort(),
    ['AC_01','AC_02','AC_03','AC_04']);
  assert.ok(predio.sessions.filter(session=>session.status==='UNSERVED')
    .every(session=>session.sourceChargerId===null&&session.deliveredEnergyKwh==='0.00000000'));
});

test('Prédio preserves original kWh and per-event revenue while fictional payment categories match delivered quotas',()=>{
  const dataset=loadDemoDataset('PREDIO',source);
  const served=dataset.sessions.filter(session=>session.status==='COMPLETED');
  const ids=served.map(session=>session.sourceSessionId);
  const categories=predioPaymentAttributions(ids);
  assert.equal(categories.size,2917);
  assert.deepEqual([...predioPaymentAttributions([...ids].reverse())].sort(),[...categories].sort());
  const expected=new Map(PREDIO_PAYMENT_QUOTAS.map(bucket=>[`${bucket.channel}:${bucket.method}`,bucket.count]));
  const actual=new Map<string,number>();
  let revenueCents=0,costCents=0;
  for(const session of served){
    const choice=categories.get(session.sourceSessionId)!;
    const key=`${choice.channel}:${choice.method}`;
    actual.set(key,(actual.get(key)??0)+1);
    const financial=demoFinancials(session,PREDIO_FINANCIAL_SCENARIO);
    assert.equal(financial.billable,true);
    revenueCents+=Math.round(Number(financial.amount)*100);
    costCents+=Math.round(Number(financial.costAmount)*100);
  }
  assert.deepEqual([...actual].sort(),[...expected].sort());
  assert.equal(revenueCents,10138131);
  assert.equal(costCents,3686581);
  assert.equal(PREDIO_SUPPLIED_PACKAGE.suppliedRevenueBrl,'101381.50');
  assert.equal(PREDIO_SUPPLIED_PACKAGE.sourceRevenueBrl,'101381.31');
  assert.equal(PREDIO_SUPPLIED_PACKAGE.suppliedEstimatedCostBrl,'36866.29');
  assert.equal(PREDIO_SUPPLIED_PACKAGE.sourceEstimatedCostBrl,'36865.81');
  assert.throws(()=>predioPaymentAttributions(ids.slice(1)),/não reconciliam/);
  assert.throws(()=>predioPaymentAttributions([...ids.slice(1),ids[1]]),/não reconciliam/);
});
