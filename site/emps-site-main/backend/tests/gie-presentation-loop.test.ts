import test from 'node:test';
import assert from 'node:assert/strict';
import { GieController } from '../src/gie.service';

function harness(bound:boolean){
 const calls:any[]=[];
 const gie={allowed:async()=>calls.push('legacy-access'),action:async(...args:any[])=>{calls.push(args);return args;}};
 const v3={binding:async()=>bound?{}:null,action:async(...args:any[])=>{calls.push(args);return args;}};
 const access={require:async()=>calls.push('station-access'),presentation:async()=>calls.push('presentation-access')};
 return {controller:new GieController(gie as any,v3 as any,{} as any,access as any,{} as any),calls};
}
test('loop forwards explicit boolean to the bound V3 station and preserves station access',async()=>{
 const {controller,calls}=harness(true);const user={id:1};
 for(const enabled of [true,false]){
  await controller.presentation({user} as any,'13','loop',{enabled});
  assert.deepEqual(calls.at(-1),[user,'13','presentation',{action:'loop',enabled}]);
 }
 assert.ok(calls.includes('station-access'));
});
test('legacy loop retains both station and presentation permission checks',async()=>{
 const {controller,calls}=harness(false);
 await controller.presentation({user:{id:1}} as any,'39','loop',{enabled:true});
 assert.deepEqual(calls,['station-access','legacy-access','presentation-access',['/presentation/loop',{enabled:true}]]);
});
test('loop rejects missing/nonboolean values and enabled on unrelated actions before mutation',async()=>{
 const {controller,calls}=harness(true);
 for(const body of [{},{enabled:'true'},{enabled:1},{enabled:null}])
  await assert.rejects(controller.presentation({user:{}} as any,'13','loop',body as any));
 await assert.rejects(controller.presentation({user:{}} as any,'13','start',{enabled:true}));
 assert.deepEqual(calls,[]);
 await controller.presentation({user:{}} as any,'13','start',{});
 assert.deepEqual(calls.at(-1),[{},'13','presentation',{action:'start'}]);
});
