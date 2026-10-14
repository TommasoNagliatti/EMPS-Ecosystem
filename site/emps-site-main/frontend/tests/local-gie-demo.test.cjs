const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
function load(file, mocks) {
  const filename = path.resolve(__dirname, '..', file), child = new Module(filename, module);
  child.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = child.require.bind(child);
  child.require = name => Object.hasOwn(mocks, name) ? mocks[name] : original(name);
  child._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,
    target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);
  return child.exports;
}
const demo = {station_id:'39',online:true,isolated:true,mode:'PRESENTATION',
  state:{execution_allowed:true,numeric_state:{building_kw:50,solar_kw:80,ev_demand_kw:44,ev_served_kw:44,evse_setpoints_kw:[11,11,11,11]}},
  presentation:{scene_number:5,name:'Cena teste',playing:true},
  context:{demands:[1,2,3,4].map(n=>({charger_id:'virtual-evse-'+n,evse_slot:n,connected:true}))}};

test('isolated GIE never replaces official overview telemetry or its mode',()=>{
  let index=0,mapperCalls=0;
  const official={energyFlow:{source:'official'},carregadores:[]};
  const {AdminDashboard}=load('components/dashboard/AdminDashboard.tsx',{
    react:{...React,useState:()=>[[demo,official,false,''][index++],()=>{}],useRef:v=>({current:v}),useCallback:fn=>fn,useEffect:()=>{}},
    '@/components/energy/GieControls':{GieControls:()=>null},'@/components/shell/AppShell':{AppShell:()=>null},
    '@/components/realtime/RealtimeProvider':{useRealtime:()=>({changeRevision:0,connectionVersion:0,status:'disabled'})},
    '@/domain/gie':{energyFromGie:()=>{mapperCalls++;return {}; }},'./StationDashboard':{StationDashboard:()=>null},
    '@/services/emps-api':{isDemoMode:false,api:{}}
  });
  const panel=AdminDashboard({stationId:'39'}).props.children;
  assert.equal(panel.props.telemetry,official.energyFlow);
  assert.equal(panel.props.gieMode,undefined);assert.equal(mapperCalls,0);
});

test('GIE replay is visibly simulated with four virtual slots and no enabled commands',()=>{
  let index=0;
  const states=[[{id:'39',name:'Estacao teste',giePrimary:true}],'39',demo,'',false,'','1',true];
  const {GieControls}=load('components/energy/GieControls.tsx',{
    react:{...React,useState:()=>[states[index++],()=>{}],useRef:v=>({current:v}),useCallback:fn=>fn,useEffect:()=>{}},
    './GieControls.module.css':{__esModule:true,default:{}},
    '@/services/emps-api':{frontSession:{get:()=>({role:'admin'})},selectedStation:{get:()=> '39'},api:{}}
  });
  const html=renderToStaticMarkup(GieControls({onState:()=>{}}));
  assert.match(html,/GIE · Teste local/);assert.match(html,/Conectado/);assert.match(html,/Simulação isolada/);
  for(const slot of [1,2,3,4])assert.match(html,new RegExp('Carregador virtual '+slot));
  assert.match(html,/Sem medição física, comandos, cobrança ou gravação no banco oficial/);
  const buttons=html.match(/<button\b[^>]*>/g);
  assert.ok(buttons.length>0);assert.ok(buttons.every(tag=>tag.includes('disabled')));
});
