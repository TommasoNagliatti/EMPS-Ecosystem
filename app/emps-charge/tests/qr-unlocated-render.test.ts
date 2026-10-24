import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import { createRequire } from 'node:module';
import React from 'react';
import ts from 'typescript';
import type { Station } from '../src/domain/models';

const {renderToStaticMarkup}=createRequire(import.meta.url)('react-dom/server') as {
 renderToStaticMarkup:(node:React.ReactNode)=>string;
};

const root=path.resolve(import.meta.dirname,'..');
const station:Station={id:'13',name:'Prédio Comercial',address:'Demonstração',neighborhood:'',city:'',
 coordinates:null,coordinatesUnavailable:true,openingHours:'24h',amenities:[],chargerIds:[]};
const box=({children}:any)=>React.createElement('div',null,children);
const app={user:{name:'Teste'},activeSession:null,chargers:[],stations:[station],isDemoMode:false,
 isStationsLoading:false,loadNearbyStations:async()=>{},getStation:()=>station,getCharger:()=>null,getStationChargers:()=>[]};

function load(relative:string,extra:Record<string,unknown>={},cache=new Map<string,any>()):any{
 let file=path.resolve(root,relative);
 if(!path.extname(file))file+=fs.existsSync(file+'.ts')?'.ts':'.tsx';
 if(cache.has(file))return cache.get(file).exports;
 const child:any=new (Module as any)(file,module);child.paths=(Module as any)._nodeModulePaths(path.dirname(file));cache.set(file,child);
 const original=child.require.bind(child);
 const mocks:Record<string,unknown>={
  'react-native':{View:box,Text:box,Pressable:box,ScrollView:box,TextInput:()=>null,ActivityIndicator:()=>null,
   StyleSheet:{create:(s:unknown)=>s},Alert:{alert:()=>{}},Platform:{OS:'ios'}},
  'react-native-webview':{WebView:()=>null},'react-native-safe-area-context':{SafeAreaView:box},
  'expo-location':{},'expo-linear-gradient':{LinearGradient:box},'expo-router':{useRouter:()=>({push:()=>{}})},
  'lucide-react-native':new Proxy({},{get:()=>()=>null}),
  '@/context/app-context':{useApp:()=>app,getLiveSessionMetrics:()=>null},
  '@/components/brand':{Brand:()=>null},'@/components/station-photo':{StationPhoto:()=>null},
  '@/components/ui/status-pill':{StatusPill:()=>null},
  '@/constants/theme':{Colors:{},Fonts:{},Radius:{},Shadow:{},MaxContentWidth:650},...extra,
 };
 child.require=(specifier:string)=>{
  if(Object.hasOwn(mocks,specifier))return mocks[specifier];
  if(specifier.startsWith('@/'))return load('src/'+specifier.slice(2),extra,cache);
  if(specifier.startsWith('.'))return load(path.relative(root,path.resolve(path.dirname(file),specifier)),extra,cache);
  return original(specifier);
 };
 child._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,
  target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,file);
 return child.exports;
}

test('home and both map renderers accept the null-location station added by QR resolution',()=>{
 const Home=load('src/app/(tabs)/index.tsx').default;
 const html=renderToStaticMarkup(React.createElement(Home));
 assert.match(html,/Prédio Comercial/);assert.match(html,/Distância indisponível/);
 for(const file of ['src/components/station-map.tsx','src/components/station-map.web.tsx']){
  const {StationMap}=load(file);
  assert.doesNotThrow(()=>renderToStaticMarkup(React.createElement(StationMap,{stations:[station],chargers:[],
   userCoordinate:{latitude:-23.56,longitude:-46.65},onSelectStation:()=>{}})));
 }
});

test('directions for a station without coordinates inform the user without opening a fabricated route',async()=>{
 const messages:unknown[][]=[];const routes:string[]=[];
 const {openDirections}=load('src/utils/maps.ts',{'react-native':{Alert:{alert:(...v:unknown[])=>messages.push(v)},
  Linking:{openURL:async(url:string)=>routes.push(url)},Platform:{OS:'ios'}}});
 await openDirections(station);assert.equal(messages.length,1);assert.equal(routes.length,0);
 await openDirections({...station,coordinatesUnavailable:false,coordinates:{latitude:0,longitude:0}});
 assert.equal(routes.length,1);assert.match(routes[0],/daddr=0,0/);
});
