import {createHash} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {parse} from 'csv-parse/sync';

export type DemoDatasetKind = 'SHOPPING' | 'POSTO' | 'CASA';
type CsvRow = Record<string,string>;

export type DemoDatasetSourceFile = {relativePath:string; sha256:string; rowCount:number|null};
export type DemoDatasetSession = {
  sourceSessionId:string; sourceChargerId:string|null; startedAt:Date; endedAt:Date|null;
  requestedEnergyKwh:string|null; deliveredEnergyKwh:string; sourceStatus:string;
  status:'COMPLETED'|'UNSERVED'; sourcePayload:CsvRow;
};
export type DemoDatasetReading = {
  sourceReadingId:string; intervalStart:Date; intervalEnd:Date;
  buildingPowerKw:string|null; buildingEnergyKwh:string|null;
  solarPowerKw:string|null; solarEnergyKwh:string|null; gridPowerKw:string|null;
  evRequestedPowerKw:string|null; evDeliveredPowerKw:string|null; evDeliveredEnergyKwh:string|null;
  batteryStates:Record<string,{available:boolean}>|null;
  sourcePayload:Record<string,CsvRow>;
};
export type DemoDataset = {
  kind:DemoDatasetKind; gieStationId:string; datasetKey:string; datasetSha256:string;
  sourceStartedAt:Date; sourceEndedAt:Date; sourceFiles:DemoDatasetSourceFile[];
  sessions:DemoDatasetSession[]; readings:DemoDatasetReading[];
};

const INTERVAL_MS=15*60*1000;
const configurations={
  SHOPPING:{gieStationId:'Commercial_HighAutonomy_V2',datasetKey:'COMMERCIAL_2026_H1_V1',prefix:''},
  POSTO:{gieStationId:'DEMO_POSTO_24H_001',datasetKey:'POSTO_24H_V1_2025',prefix:'synthetic_profiles/posto_24h_v1/'},
  CASA:{gieStationId:'DEMO_CASA_001',datasetKey:'RESIDENCIAL_V1_2025',prefix:'synthetic_profiles/residencial_v1/'},
} as const;

function sha256(bytes:Buffer|string){return createHash('sha256').update(bytes).digest('hex');}
function assertValue(condition:unknown,message:string):asserts condition {if(!condition)throw new Error(`Dataset GIE inválido: ${message}`);}
function dataDirectory(root:string){
  const direct=resolve(root);
  if(existsSync(join(direct,'consumo_predio_6_meses.csv')))return direct;
  const nested=join(direct,'data');
  if(existsSync(join(nested,'consumo_predio_6_meses.csv')))return nested;
  throw new Error('Dataset GIE inválido: diretório data não encontrado');
}
function sourceReader(root:string){
  const files:DemoDatasetSourceFile[]=[];
  function bytes(relativePath:string){
    const buffer=readFileSync(join(root,...relativePath.split('/')));
    files.push({relativePath,sha256:sha256(buffer),rowCount:null});
    return buffer;
  }
  function csv(relativePath:string,required:string[]):CsvRow[]{
    const buffer=bytes(relativePath);
    const rows=parse(buffer,{columns:true,bom:true,skip_empty_lines:true}) as CsvRow[];
    assertValue(rows.length>0,`${relativePath} vazio`);
    for(const column of required)assertValue(Object.hasOwn(rows[0],column),`${relativePath} sem coluna ${column}`);
    files.at(-1)!.rowCount=rows.length;
    return rows;
  }
  function manifest(relativePath:string):Record<string,unknown>{
    const value=JSON.parse(bytes(relativePath).toString('utf8')) as Record<string,unknown>;
    assertValue(value&&typeof value==='object'&&!Array.isArray(value),`${relativePath} inválido`);
    return value;
  }
  return {files,csv,manifest};
}
function date(value:string,label:string,offsetInSource:boolean):Date{
  assertValue(typeof value==='string'&&value.length>0,`${label} ausente`);
  const pattern=offsetInSource
    ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-03:00$/
    : /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
  assertValue(pattern.test(value),`${label} fora do formato local UTC−03:00`);
  const local=value.slice(0,19).replace(' ','T');
  const parsed=new Date(`${local}-03:00`);
  assertValue(Number.isFinite(parsed.getTime()),`${label} inválido`);
  const roundTrip=new Date(parsed.getTime()-3*60*60*1000).toISOString().slice(0,19);
  assertValue(roundTrip===local,`${label} inválido`);
  return parsed;
}
function nonnegative(row:CsvRow,key:string,label:string):string{
  const value=row[key];
  assertValue(typeof value==='string'&&/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value),`${label}.${key} deve ser decimal não negativo`);
  assertValue(Number.isFinite(Number(value)),`${label}.${key} fora da faixa numérica`);
  return value;
}
function available(row:CsvRow,key:string,label:string):boolean{
  assertValue(row[key]==='0'||row[key]==='1',`${label}.${key} deve ser 0 ou 1`);
  return row[key]==='1';
}
function intervalEnergy(powerKw:string,energyKwh:string,label:string){
  assertValue(Math.abs(Number(powerKw)*0.25-Number(energyKwh))<=1e-6,`${label} tem potência e energia incompatíveis`);
}
function timeline(rows:CsvRow[],label:string,offsetInSource:boolean):Date[]{
  let previous:number|undefined;
  return rows.map((row,index)=>{
    const timestamp=date(row.timestamp,`${label} linha ${index+2}`,offsetInSource);
    const ms=timestamp.getTime();
    assertValue(ms%INTERVAL_MS===0,`${label} fora do quarto de hora na linha ${index+2}`);
    assertValue(previous===undefined||ms-previous===INTERVAL_MS,`${label} com duplicata, lacuna ou desordem na linha ${index+2}`);
    previous=ms;
    return timestamp;
  });
}
function sameTimeline(reference:CsvRow[],other:CsvRow[],label:string){
  assertValue(reference.length===other.length,`${label} tem número de intervalos diferente`);
  for(let i=0;i<reference.length;i++)assertValue(reference[i].timestamp===other[i].timestamp,`${label} diverge em ${i+1}`);
}
function sessionsCommercial(rows:CsvRow[]):DemoDatasetSession[]{
  const ids=new Set<string>();
  return rows.map((row,index)=>{
    const label=`sessões comerciais linha ${index+2}`,id=row.session_id;
    assertValue(id&&!ids.has(id),`${label} com ID vazio ou duplicado`);ids.add(id);
    const requested=nonnegative(row,'energia_solicitada_kwh',label);
    const delivered=nonnegative(row,'energia_entregue_kwh',label);
    assertValue(Number(delivered)<=Number(requested)+1e-8,`${label} entregou mais energia do que solicitou`);
    const positive=Number(delivered)>0;
    const arrival=date(row.hora_chegada,`${label}.hora_chegada`,false);
    const start=row.inicio_conexao?date(row.inicio_conexao,`${label}.inicio_conexao`,false):arrival;
    const end=date(row.hora_saida,`${label}.hora_saida`,false);
    assertValue(end.getTime()>=start.getTime()&&start.getTime()>=arrival.getTime(),`${label} com cronologia inválida`);
    if(row.fim_carregamento){
      const chargeEnd=date(row.fim_carregamento,`${label}.fim_carregamento`,false);
      assertValue(chargeEnd.getTime()>=start.getTime()&&chargeEnd.getTime()<=end.getTime(),`${label} com fim de carga inválido`);
    }
    assertValue(positive===Boolean(row.charger_id)&&positive===Boolean(row.inicio_conexao),`${label} com energia, conexão e carregador divergentes`);
    assertValue(positive?(row.status==='atendida'):(row.status==='abandono_espera'||row.status==='abandono_fila_cheia'),`${label} com status incoerente`);
    return {sourceSessionId:id,sourceChargerId:row.charger_id||null,startedAt:start,endedAt:end,
      requestedEnergyKwh:requested,deliveredEnergyKwh:delivered,sourceStatus:row.status,
      status:positive?'COMPLETED':'UNSERVED',sourcePayload:row};
  });
}
function sessionsProfile(rows:CsvRow[],gieStationId:string):DemoDatasetSession[]{
  const ids=new Set<string>();
  return rows.map((row,index)=>{
    const label=`sessões ${gieStationId} linha ${index+2}`,id=row.session_id;
    assertValue(id&&!ids.has(id),`${label} com ID vazio ou duplicado`);ids.add(id);
    assertValue(row.station_id===gieStationId&&row.origin==='SIMULATED',`${label} com estação ou origem divergente`);
    const requested=nonnegative(row,'requested_ac_kwh',label);
    const delivered=nonnegative(row,'delivered_ac_kwh',label);
    assertValue(Number(delivered)<=Number(requested)+1e-8,`${label} entregou mais energia do que solicitou`);
    const positive=Number(delivered)>0;
    const arrival=date(row.chegada,`${label}.chegada`,true);
    const start=row.inicio?date(row.inicio,`${label}.inicio`,true):arrival;
    const end=date(row.termino,`${label}.termino`,true);
    assertValue(end.getTime()>=start.getTime()&&start.getTime()>=arrival.getTime(),`${label} com cronologia inválida`);
    if(row.fim_carga){
      const chargeEnd=date(row.fim_carga,`${label}.fim_carga`,true);
      assertValue(chargeEnd.getTime()>=start.getTime()&&chargeEnd.getTime()<=end.getTime(),`${label} com fim de carga inválido`);
    }
    assertValue(positive===Boolean(row.evse_id)&&positive===Boolean(row.inicio)&&positive===Boolean(row.fim_carga),`${label} com energia, conexão e carregador divergentes`);
    return {sourceSessionId:id,sourceChargerId:row.evse_id||null,startedAt:start,endedAt:end,
      requestedEnergyKwh:requested,deliveredEnergyKwh:delivered,sourceStatus:row.reason,
      status:positive?'COMPLETED':'UNSERVED',sourcePayload:row};
  });
}
function validateManifest(manifest:Record<string,unknown>,files:DemoDatasetSourceFile[],gieStationId:string,profile:string,rows:number){
  assertValue(manifest.station_id===gieStationId&&manifest.profile===profile&&manifest.origin==='SIMULATED',`manifesto ${profile} com identidade divergente`);
  assertValue(manifest.interval_minutes===15&&manifest.timezone==='America/Sao_Paulo'&&manifest.utc_offset==='-03:00',`manifesto ${profile} com tempo divergente`);
  assertValue(manifest.rows===rows,`manifesto ${profile} com número de intervalos divergente`);
  const hashes=manifest.outputs_sha256 as Record<string,unknown>|undefined;
  assertValue(hashes&&typeof hashes==='object',`manifesto ${profile} sem hashes`);
  for(const file of files.filter(file=>file.relativePath.endsWith('.csv'))){
    const short=file.relativePath.split('/').at(-1)!;
    assertValue(hashes[short]===file.sha256,`manifesto ${profile} diverge do arquivo ${short}`);
  }
}
function reconcile(sessions:DemoDatasetSession[],readings:DemoDatasetReading[]){
  const sessionEnergy=sessions.reduce((sum,item)=>sum+Number(item.deliveredEnergyKwh),0);
  const intervalEnergy=readings.reduce((sum,item)=>sum+Number(item.evDeliveredEnergyKwh),0);
  assertValue(Math.abs(sessionEnergy-intervalEnergy)<=1e-5,`energia das sessões (${sessionEnergy}) diverge dos intervalos (${intervalEnergy})`);
}

/** Read-only parser of frozen GIE synthetic history; sourceEndedAt is exclusive. */
export function loadDemoDataset(kind:DemoDatasetKind,dataRoot:string):DemoDataset{
  const cfg=configurations[kind];
  assertValue(cfg,`perfil ${String(kind)} desconhecido`);
  const root=dataDirectory(dataRoot),reader=sourceReader(root),prefix=cfg.prefix;
  const commercial=kind==='SHOPPING';
  const building=reader.csv(commercial?'consumo_predio_6_meses.csv':`${prefix}building.csv`,
    commercial?['timestamp','consumo_predio_kw','consumo_predio_kwh']:
      ['timestamp','station_id','origin','available_at','consumo_predio_kw','consumo_predio_kwh']);
  const energy=commercial?null:reader.csv(`${prefix}energy.csv`,
    ['timestamp','station_id','origin','available_at','pv_generation_ac_kw','pv_generation_ac_kwh','grid_available']);
  const ev=reader.csv(commercial?'demanda_carregadores_6_meses.csv':`${prefix}ev.csv`,
    commercial?['timestamp','potencia_solicitada_kw','potencia_entregue_kw','energia_entregue_kwh']:
      ['timestamp','station_id','origin','available_at','potencia_solicitada_kw','potencia_entregue_kw','energia_entregue_kwh']);
  const sessionRows=reader.csv(commercial?'sessoes_carregadores_6_meses.csv':`${prefix}sessions.csv`,commercial
    ? ['session_id','hora_chegada','inicio_conexao','hora_saida','energia_solicitada_kwh','energia_entregue_kwh','charger_id','status']
    : ['session_id','station_id','origin','chegada','inicio','termino','fim_carga','requested_ac_kwh','delivered_ac_kwh','evse_id','reason']);
  const manifest=commercial?null:reader.manifest(`${prefix}manifest.json`);
  const times=timeline(building,'edificação',!commercial);
  sameTimeline(building,ev,'EV');
  if(energy)sameTimeline(building,energy,'energia');
  if(manifest)validateManifest(manifest,reader.files,cfg.gieStationId,kind==='POSTO'?'POSTO_24H_V1':'RESIDENCIAL_V1',building.length);
  const readings=building.map((b,index):DemoDatasetReading=>{
    const label=`intervalo ${index+1}`,e=ev[index],solar=energy?.[index]??null;
    if(!commercial){
      for(const row of [b,e,solar!]){
        assertValue(row.station_id===cfg.gieStationId&&row.origin==='SIMULATED',`${label} com estação ou origem divergente`);
        assertValue(date(row.available_at,`${label}.available_at`,true).getTime()===times[index].getTime()+INTERVAL_MS,
          `${label} com disponibilidade fora do fim do intervalo`);
      }
      available(solar!,'grid_available',label);
    }
    const batteryStates=kind==='POSTO'?{
      BAT_01:{available:available(solar!,'BAT_01_available',label)},
      BAT_02:{available:available(solar!,'BAT_02_available',label)},
    }:null;
    const start=times[index];
    const buildingPowerKw=nonnegative(b,'consumo_predio_kw',label);
    const buildingEnergyKwh=nonnegative(b,'consumo_predio_kwh',label);
    const solarPowerKw=solar?nonnegative(solar,'pv_generation_ac_kw',label):null;
    const solarEnergyKwh=solar?nonnegative(solar,'pv_generation_ac_kwh',label):null;
    const evRequestedPowerKw=nonnegative(e,'potencia_solicitada_kw',label);
    const evDeliveredPowerKw=nonnegative(e,'potencia_entregue_kw',label);
    const evDeliveredEnergyKwh=nonnegative(e,'energia_entregue_kwh',label);
    intervalEnergy(buildingPowerKw,buildingEnergyKwh,`${label} edificação`);
    intervalEnergy(evDeliveredPowerKw,evDeliveredEnergyKwh,`${label} EV`);
    if(solarPowerKw!==null&&solarEnergyKwh!==null)intervalEnergy(solarPowerKw,solarEnergyKwh,`${label} solar`);
    return {sourceReadingId:b.timestamp,intervalStart:start,intervalEnd:new Date(start.getTime()+INTERVAL_MS),
      buildingPowerKw,buildingEnergyKwh,solarPowerKw,solarEnergyKwh,gridPowerKw:null,
      evRequestedPowerKw,evDeliveredPowerKw,evDeliveredEnergyKwh,batteryStates,
      sourcePayload:solar?{building:b,energy:solar,ev:e}:{building:b,ev:e}};
  });
  const sessions=commercial?sessionsCommercial(sessionRows):sessionsProfile(sessionRows,cfg.gieStationId);
  reconcile(sessions,readings);
  const sourceFiles=reader.files.sort((a,b)=>a.relativePath<b.relativePath?-1:a.relativePath>b.relativePath?1:0);
  const datasetSha256=sha256(sourceFiles.map(file=>`${file.relativePath}\0${file.sha256}\n`).join(''));
  return {kind,gieStationId:cfg.gieStationId,datasetKey:cfg.datasetKey,datasetSha256,
    sourceStartedAt:times[0],sourceEndedAt:new Date(times.at(-1)!.getTime()+INTERVAL_MS),
    sourceFiles,sessions,readings};
}
