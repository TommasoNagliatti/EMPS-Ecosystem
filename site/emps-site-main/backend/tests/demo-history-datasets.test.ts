import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve,sep} from 'node:path';
import test from 'node:test';
import {loadDemoDataset} from '../src/demo-history-datasets';

const original=resolve(__dirname,'../../../../gie/GIE/data');
const fixtureRoot=()=>mkdtempSync(join(tmpdir(),'emps-gie-history-test-'));
function cleanup(path:string){
  assert.ok(resolve(path).startsWith(resolve(tmpdir())+sep));
  rmSync(path,{recursive:true,force:true});
}
function put(root:string,path:string,content:string){
  const file=join(root,...path.split('/'));mkdirSync(dirname(file),{recursive:true});writeFileSync(file,content,'utf8');
}

function shoppingFixture(root:string,options:{gap?:boolean;duplicate?:boolean;energyMismatch?:boolean;negative?:boolean}={}){
  const second=options.gap?'2026-01-01 00:30:00':'2026-01-01 00:15:00';
  put(root,'consumo_predio_6_meses.csv',
    `timestamp,consumo_predio_kw,consumo_predio_kwh\n2026-01-01 00:00:00,${options.negative?'-4':'4'},1\n${second},4,1\n`);
  put(root,'demanda_carregadores_6_meses.csv',
    `timestamp,potencia_solicitada_kw,potencia_entregue_kw,energia_entregue_kwh\n2026-01-01 00:00:00,2,2,0.5\n${second},2,2,0.5\n`);
  const session=`EV_A,2026-01-01 00:00:00,2026-01-01 00:00:00,2026-01-01 00:30:00,,AC_01,atendida,2,${options.energyMismatch?'2':'1'}`;
  put(root,'sessoes_carregadores_6_meses.csv',
    `session_id,hora_chegada,inicio_conexao,hora_saida,fim_carregamento,charger_id,status,energia_solicitada_kwh,energia_entregue_kwh\n${session}\n${options.duplicate?`${session}\n`:''}`);
}

function postoFixture(root:string,badStation=false){
  const prefix='synthetic_profiles/posto_24h_v1/';
  const station='DEMO_POSTO_24H_001',wrong=badStation?'DEMO_CASA_001':station;
  const timestamp='2025-01-01T00:00:00-03:00',availableAt='2025-01-01T00:15:00-03:00';
  const content={
    'building.csv':`timestamp,station_id,origin,available_at,consumo_predio_kw,consumo_predio_kwh\n${timestamp},${station},SIMULATED,${availableAt},4,1\n`,
    'energy.csv':`timestamp,station_id,origin,available_at,pv_generation_ac_kw,pv_generation_ac_kwh,grid_available,BAT_01_available,BAT_02_available\n${timestamp},${wrong},SIMULATED,${availableAt},2,0.5,1,1,0\n`,
    'ev.csv':`timestamp,station_id,origin,available_at,potencia_solicitada_kw,potencia_entregue_kw,energia_entregue_kwh\n${timestamp},${station},SIMULATED,${availableAt},4,4,1\n`,
    'sessions.csv':`session_id,station_id,origin,chegada,inicio,termino,fim_carga,requested_ac_kwh,delivered_ac_kwh,evse_id,reason\nDEMO_POSTO_24H_001_S1,${station},SIMULATED,${timestamp},${timestamp},${availableAt},${availableAt},1,1,EVSE_01,target_reached\n`,
  };
  for(const [name,value] of Object.entries(content))put(root,prefix+name,value);
  const outputs_sha256=Object.fromEntries(Object.entries(content).map(([name,value])=>[name,createHash('sha256').update(value).digest('hex')]));
  put(root,prefix+'manifest.json',JSON.stringify({station_id:station,profile:'POSTO_24H_V1',origin:'SIMULATED',
    interval_minutes:15,timezone:'America/Sao_Paulo',utc_offset:'-03:00',rows:1,outputs_sha256}));
  // dataRoot also accepts a complete GIE data directory with the commercial files alongside the profiles.
  put(root,'consumo_predio_6_meses.csv','timestamp,consumo_predio_kw,consumo_predio_kwh\n');
}

test('frozen source sessions reconcile with 15-minute EV readings for all three stations',()=>{
  const expected=[
    {kind:'SHOPPING' as const,sessions:5477,completed:2917,readings:17376,kwh:46082.44141759,
      first:'2026-01-01T03:00:00.000Z',end:'2026-07-01T03:00:00.000Z'},
    {kind:'POSTO' as const,sessions:2289,completed:2085,readings:35040,kwh:39495.7439304049,
      first:'2025-01-01T03:00:00.000Z',end:'2026-01-01T03:00:00.000Z'},
    {kind:'CASA' as const,sessions:42,completed:42,readings:35040,kwh:756.4236898176,
      first:'2025-01-01T03:00:00.000Z',end:'2026-01-01T03:00:00.000Z'},
  ];
  for(const item of expected){
    const dataset=loadDemoDataset(item.kind,original);
    assert.equal(dataset.sessions.length,item.sessions);
    assert.equal(dataset.sessions.filter(session=>session.status==='COMPLETED').length,item.completed);
    assert.equal(dataset.readings.length,item.readings);
    assert.ok(Math.abs(dataset.sessions.reduce((sum,session)=>sum+Number(session.deliveredEnergyKwh),0)-item.kwh)<1e-6);
    assert.equal(dataset.sourceStartedAt.toISOString(),item.first);
    assert.equal(dataset.sourceEndedAt.toISOString(),item.end);
    assert.ok(dataset.sessions.every(session=>session.status==='COMPLETED'||Number(session.deliveredEnergyKwh)===0));
    assert.ok(dataset.readings.every(reading=>reading.gridPowerKw===null));
    assert.ok(dataset.sourceFiles.every(file=>file.sha256.length===64));
  }
});

test('commercial source preserves local UTC-03 time and leaves unavailable solar and grid null',t=>{
  const root=fixtureRoot();t.after(()=>cleanup(root));shoppingFixture(root);
  const dataset=loadDemoDataset('SHOPPING',root);
  assert.equal(dataset.sessions[0].startedAt.toISOString(),'2026-01-01T03:00:00.000Z');
  assert.equal(dataset.sessions[0].endedAt?.toISOString(),'2026-01-01T03:30:00.000Z');
  assert.equal(dataset.readings[0].solarPowerKw,null);
  assert.equal(dataset.readings[0].solarEnergyKwh,null);
  assert.equal(dataset.readings[0].gridPowerKw,null);
  assert.equal(dataset.readings[0].batteryStates,null);
  assert.equal(dataset.datasetSha256,loadDemoDataset('SHOPPING',root).datasetSha256);
});

test('commercial import refuses gaps, duplicate events, negative values, and energy mismatches',t=>{
  const root=fixtureRoot();t.after(()=>cleanup(root));
  for(const [options,message] of [
    [{gap:true},/lacuna/],[{duplicate:true},/duplicado/],[{negative:true},/não negativo/],
    [{energyMismatch:true},/energia das sessões/],
  ] as const){
    shoppingFixture(root,options);
    assert.throws(()=>loadDemoDataset('SHOPPING',root),message);
  }
});

test('profile joins exact source times, preserves battery availability without inventing SOC, and refuses wrong station',t=>{
  const root=fixtureRoot();t.after(()=>cleanup(root));postoFixture(root);
  const dataset=loadDemoDataset('POSTO',root);
  assert.deepEqual(dataset.readings[0].batteryStates,{BAT_01:{available:true},BAT_02:{available:false}});
  assert.equal(dataset.readings[0].gridPowerKw,null);
  assert.equal(dataset.readings[0].solarPowerKw,'2');
  assert.equal(dataset.sessions[0].sourceChargerId,'EVSE_01');
  assert.equal(dataset.sessions[0].status,'COMPLETED');
  postoFixture(root,true);
  assert.throws(()=>loadDemoDataset('POSTO',root),/estação ou origem divergente/);
});
