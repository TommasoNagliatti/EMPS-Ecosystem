import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import test from 'node:test';
import {Prisma} from '@prisma/client';
import {loadDemoDataset} from '../src/demo-history-datasets';
import {fictionalDemoDriver,RESIDENTIAL_SCENARIO_VERSION,residentialScenarioFor}
  from '../src/demo-history-residential-scenario';

const sourceRoot=resolve(__dirname,'../../../../gie/GIE/data');

test('residential v2 classifies the 42 original sessions without changing energy or dates',()=>{
  const dataset=loadDemoDataset('CASA',sourceRoot);
  const scenarios=dataset.sessions.map(residentialScenarioFor);
  assert.equal(dataset.sessions.length,42);
  assert.equal(scenarios.filter(row=>row.usageKind==='OWNER').length,32);
  assert.equal(scenarios.filter(row=>row.usageKind==='VISITOR').length,10);
  assert.ok(scenarios.every(row=>row.scenarioVersion===RESIDENTIAL_SCENARIO_VERSION&&row.origin==='SIMULATED'));
  assert.ok(scenarios.filter(row=>row.usageKind==='OWNER').every(row=>
    row.amount==='0.00'&&row.channel===null&&row.method===null&&
    row.credentialKind==='HYPOTHETICAL_RFID'&&row.driverKey==='DEMO-CASA-OWNER-001'));
  assert.ok(scenarios.filter(row=>row.usageKind==='VISITOR').every(row=>
    new Prisma.Decimal(row.amount).greaterThan(0)&&row.channel!==null&&row.method!==null&&
    row.credentialKind==='NONE'));
  assert.equal(dataset.sessions.reduce((sum,row)=>sum.add(row.deliveredEnergyKwh),new Prisma.Decimal(0)).toFixed(10),
    '756.4236898176');
  assert.deepEqual(dataset.sessions.map(row=>row.startedAt.toISOString()),
    loadDemoDataset('CASA',sourceRoot).sessions.map(row=>row.startedAt.toISOString()));
  assert.deepEqual(dataset.sessions.map(residentialScenarioFor),scenarios);
});

test('residential v2 charges only visitors and never reports net profit',()=>{
  const scenarios=loadDemoDataset('CASA',sourceRoot).sessions.map(residentialScenarioFor);
  const money=(values:string[])=>values.reduce((sum,value)=>sum.add(value),new Prisma.Decimal(0));
  const owners=scenarios.filter(row=>row.usageKind==='OWNER');
  const visitors=scenarios.filter(row=>row.usageKind==='VISITOR');
  const ownerCost=money(owners.map(row=>row.costAmount));
  const visitorCost=money(visitors.map(row=>row.costAmount));
  const visitorRevenue=money(visitors.map(row=>row.amount));
  assert.equal(ownerCost.toFixed(2),'447.05');
  assert.equal(visitorCost.toFixed(2),'158.08');
  assert.equal(visitorRevenue.toFixed(2),'434.72');
  assert.equal(ownerCost.add(visitorCost).toFixed(2),'605.13');
  assert.equal(money(owners.map(row=>row.amount)).toFixed(2),'0.00');
  assert.ok(ownerCost.greaterThan(0));
  assert.ok(visitorCost.greaterThan(0));
  assert.ok(visitorRevenue.greaterThan(0));
  assert.ok(visitorRevenue.lessThan(new Prisma.Decimal('1664.13')));
  assert.equal(Object.hasOwn(scenarios[0],'netProfit'),false);
});

test('fictional driver labels are deterministic and never create authenticatable users',()=>{
  const first=fictionalDemoDriver('POSTO','DEMO_POSTO_24H_001_S00001');
  assert.deepEqual(first,fictionalDemoDriver('POSTO','DEMO_POSTO_24H_001_S00001'));
  assert.notDeepEqual(first,fictionalDemoDriver('POSTO','DEMO_POSTO_24H_001_S00002'));
  assert.match(first.driverKey,/^DEMO-POSTO-[0-9A-F]{12}$/);
  assert.ok(!JSON.stringify(first).includes('password'));
  assert.throws(()=>residentialScenarioFor({sourceSessionId:'OTHER_S1',status:'COMPLETED',
    deliveredEnergyKwh:'1',endedAt:new Date('2025-01-01T00:00:00Z')}),/fora do formato/);
});
