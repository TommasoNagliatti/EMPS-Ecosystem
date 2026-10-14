"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {ChevronDown,Activity,Link2,Radio,Settings2} from 'lucide-react';
import {api,frontSession,selectedStation} from '@/services/emps-api';
import type {GieState} from '@/domain/gie';
import styles from './GieControls.module.css';
type Station={id:string;name:string;giePrimary?:boolean};
const modes={NORMAL:'Normal · horário e sessões',PRESENTATION:'Apresentação · cenas',MANUAL_DEMO:'Demo manual · sessões',SIMULATION:'Simulação · entrada externa'};
export function GieControls({onState,initialStationId}:{onState:(state:GieState)=>void;initialStationId?:string}) {
 const [stations,setStations]=useState<Station[]>([]),[stationId,setStationId]=useState(initialStationId??''),[state,setState]=useState<GieState|null>(null);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[chargerId,setChargerId]=useState(''),[slot,setSlot]=useState('1');
 const [presentationTools,setPresentationTools]=useState(false);
 useEffect(()=>{void api.platform<{presentationTools:boolean}>('/auth/me').then(a=>setPresentationTools(a.presentationTools)).catch(()=>undefined)},[]);
 const generation=useRef(0);
 useEffect(()=>{let alive=true;void api.stations().then(rows=>{if(!alive)return;const list=rows as Station[];setStations(list);setStationId(String(initialStationId??selectedStation.get()??list[0]?.id??''));}).catch(e=>setError(e.message));return()=>{alive=false;};},[initialStationId]);
 const pending=useRef<Promise<boolean>|null>(null);
 const load=useCallback(()=>{
  if(pending.current)return pending.current;
  if(!stationId)return Promise.resolve(false);
  const gen=generation.current;
  const request=(async()=>{try{const next=await api.gieState(stationId);if(gen!==generation.current)return false;setState(next);onState(next);setError('');return next.online;}catch(e){if(gen!==generation.current)return false;setError(e instanceof Error?e.message:'GIE indisponível');const offline:GieState={online:false,station_id:stationId,mode:'UNKNOWN',observed_at:new Date().toISOString(),state:null};setState(offline);onState(offline);return false;}})();
  pending.current=request;
  void request.finally(()=>{if(pending.current===request)pending.current=null;});
  return request;
 },[stationId,onState]);
 useEffect(()=>{
  generation.current++;pending.current=null;
  let active=true,timer:ReturnType<typeof setTimeout>;
  async function poll(){
   const online=document.visibilityState==='hidden'?false:await load();
   if(active)timer=setTimeout(()=>void poll(),online?5000:30000);
  }
  void poll();
  return()=>{active=false;generation.current++;clearTimeout(timer);};
 },[load]);
 async function action(path:string,body:unknown={}){setBusy(true);setError('');try{await api.gieAction(stationId,path,body);await load();}catch(e){setError(e instanceof Error?e.message:'Comando não executado');}finally{setBusy(false);}}
 const selected=stations.find(s=>String(s.id)===stationId),numeric=state?.state?.numeric_state;
 const power=(key:string)=>typeof numeric?.[key]==='number'?Number(numeric[key]).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})+' kW':'Sem leitura';
 const isolated=state?.isolated===true;
 const enabled=!isolated&&!busy&&!!stationId&&!!selected?.giePrimary&&state?.online;
 const status=state?.online?(state.state?.execution_allowed?'Calculando distribuição':'Aguardando entrada válida'):'Serviço indisponível';
 return <details className={styles.panel}>
  <summary className={styles.summary}><span className={styles.icon}><Activity size={18}/></span><span className={styles.heading}><strong>{isolated?'GIE · Teste local':'Controle energético GIE'}</strong><small>{selected?.name??'Carregando estação'}</small></span><span className={`${styles.badge} ${state?.online?styles.online:''}`}><Radio size={12}/>{state?.online?'Conectado':'Offline'}</span><ChevronDown className={styles.chevron} size={16}/></summary>
  <div className={styles.body}>
   <div className={styles.fields}><label>Estação<select value={stationId} disabled={busy} onChange={e=>{generation.current++;setState(null);setStationId(e.target.value);}}>{stations.map(s=><option key={s.id} value={String(s.id)}>{s.name}{s.giePrimary?' · Demonstração principal':''}</option>)}</select></label>{presentationTools&&<label>Modo de operação<select value={(state?.mode??'') in modes?state!.mode:'NORMAL'} disabled={!enabled} onChange={e=>void action('mode',{mode:e.target.value})}>{Object.entries(modes).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>}</div>
   <div className={styles.state} role="status"><span className={styles.dot}/><strong>{isolated?'Simulação isolada':selected?.giePrimary?'Demonstração principal':'Sem associação com este serviço'}</strong><span>{busy?'Enviando comando…':status}</span></div>
   <p className={styles.hint}>{isolated?'Valores simulados do protótipo GIE, com quatro carregadores virtuais. Sem medição física, comandos, cobrança ou gravação no banco oficial.':state?.mode==='NORMAL'?'Normal demonstrativo: horário local, clima ou fallback e demanda das sessões. Valores de software, sem medição física.':state?.mode==='PRESENTATION'?'Cenas independentes. A apresentação não movimenta a cobrança das sessões.':state?.mode==='MANUAL_DEMO'?'Eventos demonstrativos e demanda dos carregadores associados. O motor GIE decide os limites de potência.':'Selecione um modo para acompanhar o fluxo energético.'}</p>
   {state?.mode==='PRESENTATION'&&<div className={styles.presentation}><span>Cena {state.presentation?.scene_number} · {state.presentation?.name}</span><small>{state.presentation?.playing?'Em reprodução':'Pausada'}</small></div>}
   {presentationTools&&<div className={styles.actions}>{Object.entries({start:'Iniciar apresentação',pause:'Pausar',resume:'Retomar',previous:'Anterior',next:'Próxima',reset:'Reiniciar cenas'}).map(([a,label])=><button key={a} disabled={!enabled||(a!=='start'&&state?.mode!=='PRESENTATION')} onClick={()=>void action('presentation/'+a)}>{label}</button>)}</div>}
   {presentationTools&&state?.mode==='MANUAL_DEMO'&&<div className={styles.actions}>{Object.entries({...state.manual_events,RESET:'Restaurar demo'}).map(([event,label])=><button disabled={!enabled} key={event} onClick={()=>void action('manual-demo/event',{event})}>{label}</button>)}</div>}
   <div className={styles.metrics}>{[['building_kw','Prédio'],['solar_kw','Solar'],['ev_demand_kw','EV solicitado'],['ev_served_kw','EV atendido']].map(([key,label])=><div key={key}><small>{label}</small><strong>{power(key)}</strong></div>)}</div>
   <div className={styles.slots}>{[1,2,3,4].map(n=>{const d=state?.context?.demands.find(d=>d.evse_slot===n);const v=numeric?.evse_setpoints_kw;return <div key={n}><strong>EVSE {n}</strong><span>{isolated?'Carregador virtual '+n:d?'Carregador '+d.charger_id:'Sem vínculo'}</span><small>{isolated?(d?.connected?'Demanda simulada':'Sem demanda'):(d?.connected?'Sessão ativa':'Sem sessão')} · {Array.isArray(v)&&v[n-1]!=null?Number(v[n-1]).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})+' kW':'—'}</small></div>;})}</div>
   {state?.state?.primary_message&&<p className={styles.message}>{state.state.primary_message.title}: {state.state.primary_message.text}</p>}
   {presentationTools&&frontSession.get()?.role==='admin'&&selected?.giePrimary&&<details className={styles.mapping}><summary><Settings2 size={14}/> Associações dos carregadores</summary><div className={styles.fields}><label>ID do carregador<input value={chargerId} inputMode="numeric" onChange={e=>setChargerId(e.target.value)}/></label><label>Slot<select value={slot} onChange={e=>setSlot(e.target.value)}>{[1,2,3,4].map(n=><option key={n}>{n}</option>)}</select></label><button disabled={!enabled||!/^\d+$/.test(chargerId)} onClick={()=>void action('mappings',{chargerId,evseSlot:Number(slot)})}><Link2 size={14}/> Vincular EVSE</button></div></details>}
   {(error||state?.error)&&<p className={styles.error} role="alert">{error||state?.error}</p>}
  </div>
 </details>;
}
