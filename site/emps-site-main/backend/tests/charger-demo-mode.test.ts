import test from 'node:test';
import assert from 'node:assert/strict';
import {chargerDemoEnergy,withChargerModeLock,setChargerDemo,chargerDemoEnabled} from '../src/charger-demo-mode';
import {LabMaqueteService} from '../src/lab-maquete.service';
import {GieV3Service} from '../src/gie-v3.service';
test('illustration varies slowly, both sources positive, idle EV zero, balance exact',()=>{
 for(const power of [0,11,22,36.08])for(let n=0;n<20;n++){
  const d=chargerDemoEnergy(new Date(1700000000000+n*10000),power);
  assert.equal(d.chargerPowerKw,power);assert.ok(d.solarPowerKw>0);assert.ok(d.gridPowerKw>0);
  assert.ok(Math.abs(d.solarPowerKw+d.gridPowerKw-d.buildingPowerKw-power)<1e-10);
 }
});
test('mode queue serializes concurrent starts/actions and recovers after rejection',async()=>{
 const events:string[]=[];
 const a=withChargerModeLock(13,async()=>{events.push('start');await new Promise(r=>setTimeout(r,10));events.push('committed');});
 const b=withChargerModeLock(13,async()=>{events.push('mode');throw Error('blocked');});
 await a;await assert.rejects(b);await withChargerModeLock(13,async()=>{events.push('next');});
 assert.deepEqual(events,['start','committed','mode','next']);
});
test('presentation and offline prohibit START; normal and charger demo admit; other station unchanged',async()=>{
 let mode='PRESENTATION',online=true;
 const svc=new LabMaqueteService({} as any,{} as any,{refresh:async()=>({mode,online})} as any);
 await assert.rejects(svc.assertChargerStartMode(13));
 mode='NORMAL';await svc.assertChargerStartMode(13);
 mode='CHARGER_DEMO';await svc.assertChargerStartMode(13);
 online=false;await assert.rejects(svc.assertChargerStartMode(13));await svc.assertChargerStartMode(46);
});
test('presentation refuses active sessions before contacting worker',async()=>{
 const svc=new GieV3Service({gieStationBinding:{findUnique:async()=>({gieStationId:'Commercial_HighAutonomy_V2'})},labChargeSession:{count:async()=>1}} as any,
 {require:async()=>({id:13,membershipRole:'OWNER'})} as any,{} as any);
 await assert.rejects(svc.action({} as any,'13','mode',{mode:'PRESENTATION'}),/Encerre/);
});
test('local demonstration selection never leaks to another station',()=>{
 setChargerDemo(13,true);assert.equal(chargerDemoEnabled(13),true);assert.equal(chargerDemoEnabled(46),false);setChargerDemo(13,false);
});
