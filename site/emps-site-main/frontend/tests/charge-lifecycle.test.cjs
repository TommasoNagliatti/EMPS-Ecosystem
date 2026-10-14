const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const test=require('node:test');
const filename=path.join(__dirname,'../domain/charge-lifecycle.ts'),loaded=new Module(filename,module);
loaded._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
const {removalClock,durationLabel}=loaded.exports;
const state={serverTime:'2026-10-13T13:00:00Z',stoppedAt:'2026-10-13T13:00:00Z',removalDeadline:'2026-10-13T13:10:00Z',disconnectedAt:null,overstaySeconds:0};
test('countdown is based on server time, not the client clock or a fresh ten minutes on reload',()=>{
 assert.deepEqual(removalClock(state,599000),{state:'GRACE',seconds:1});assert.deepEqual(removalClock(state,601000),{state:'OVERSTAY',seconds:1});
 assert.deepEqual(removalClock({...state,serverTime:'2026-10-13T13:09:00Z'},0),{state:'GRACE',seconds:60});
 assert.equal(durationLabel(600),'10:00');
});
test('confirmed removal freezes occupancy and active charging never starts a grace timer',()=>{
 assert.deepEqual(removalClock({...state,disconnectedAt:'2026-10-13T13:11:00Z',overstaySeconds:60},999999),{state:'REMOVED',seconds:60});
 assert.equal(removalClock({...state,stoppedAt:null},999999).state,'CHARGING');
});
test('UI refunds require explicit confirmation and cannot broaden the official read-only bridge',()=>{
 const api=fs.readFileSync(path.join(__dirname,'../services/emps-api.ts'),'utf8');
 const panel=fs.readFileSync(path.join(__dirname,'../components/chargers/ChargeLifecyclePanel.tsx'),'utf8');
 assert.match(api,/confirmCashRefund[\s\S]*?if\(isReadOnlyMode\|\|isOfficialTestBridge\)/);
 assert.match(panel,/Confirma que devolveu/);assert.match(panel,/confirmChargeRemoval/);
 assert.doesNotMatch(panel,/setInterval[\s\S]{0,100}api\.confirm/);
});
