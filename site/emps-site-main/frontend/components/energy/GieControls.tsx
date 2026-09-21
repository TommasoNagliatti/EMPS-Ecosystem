"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {ChevronDown,Activity,Link2,Radio,Settings2} from 'lucide-react';
import {api,frontSession} from '@/services/emps-api';
import type {GieState} from '@/domain/gie';
import styles from './GieControls.module.css';
type Station={id:string;name:string;giePrimary?:boolean};
const modes={NORMAL:'Normal · horário e sessões',PRESENTATION:'Apresentação · cenas',MANUAL_DEMO:'Demo manual · sessões',SIMULATION:'Simulação · entrada externa'};
export function GieControls({onState}:{onState:(state:GieState)=>void}) {
 const [stations,setStations]=useState<Station[]>([]),[stationId,setStationId]=useState(''),[state,setState]=useState<GieState|null>(null);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[chargerId,setChargerId]=useState(''),[slot,setSlot]=useState('1');
 const generation=useRef(0);
 useEffect(()=>{let alive=true;void api.stations().then(rows=>{if(!alive)return;const list=rows as Station[];setStations(list);setStationId(String(list.find(s=>s.giePrimary)?.id??list[0]?.id??''));}).catch(e=>setError(e.message));return()=>{alive=false;};},[]);
 const load=useCallback(async()=>{if(!stationId)return;const gen=generation.current;try{const next=await api.gieState(stationId);if(gen!==generation.current)return;setState(next);onState(next);setError('');}catch(e){if(gen!==generation.current)return;setError(e instanceof Error?e.message:'GIE indisponível');const offline:GieState={online:false,station_id:stationId,mode:'UNKNOWN',observed_at:new Date().toISOString(),state:null};setState(offline);onState(offline);}},[stationId,onState]);
 useEffect(()=>{generation.current++;void load();const timer=setInterval(()=>void load(),5000);return()=>{generation.current++;clearInterval(timer);};},[load]);
 async function action(path:string,body:unknown={}){setBusy(true);setError('');try{await api.gieAction(stationId,path,body);await load();}catch(e){setError(e instanceof Error?e.message:'Comando não executado');}finally{setBusy(false);}}
 const selected=stations.find(s=>String(s.id)===stationId),numeric=state?.state?.numeric_state;
 const power=(key:string)=>typeof numeric?.[key]==='number'?Number(numeric[key]).toLocaleString('pt-BR',{maximumFractionDigits:1})+' kW':'Sem leitura';
 const enabled=!busy&&!!stationId&&!!selected?.giePrimary&&state?.online;
 const status=state?.online?(state.state?.execution_allowed?'Calculando distribuição':'Aguardando entrada válida'):'Serviço indisponível';
 return <details className={styles.panel}>
  <summary className={styles.summary}><span className={styles.icon}><Activity size={18}/></span><span className={styles.heading}><strong>Controle energético GIE</strong><small>{selected?.name??'Carregando estação'}</small></span><span className={`${styles.badge} ${state?.online?styles.online:''}`}><Radio size={12}/>{state?.online?'Conectado':'Offline'}</span><ChevronDown className={styles.chevron} size={16}/></summary>
  <div className={styles.body}>
   <div className={styles.fields}><label>Estação<select value={stationId} disabled={busy} onChange={e=>{generation.current++;setState(null);setStationId(e.target.value);}}>{stations.map(s=><option key={s.id} value={String(s.id)}>{s.name}{s.giePrimary?' · Demonstração principal':''}</option>)}</select></label><label>Modo de operação<select value={(state?.mode??'') in modes?state!.mode:'NORMAL'} disabled={!enabled} onChange={e=>void action('mode',{mode:e.target.value})}>{Object.entries(modes).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label></div>
   <div className={styles.state} role="status"><span className={styles.dot}/><strong>{selected?.giePrimary?'Demonstração principal':'Sem associação com este serviço'}</strong><span>{busy?'Enviando comando…':status}</span></div>
   <p className={styles.hint}>{state?.mode==='NORMAL'?'Normal demonstrativo: horário local, clima ou fallback e demanda das sessões. Valores de software, sem medição física.':state?.mode==='PRESENTATION'?'Cenas independentes. A apresentação não movimenta a cobrança das sessões.':state?.mode==='MANUAL_DEMO'?'Eventos demonstrativos e demanda dos carregadores associados. O motor GIE decide os limites de potência.':'Selecione um modo para acompanhar o fluxo energético.'}</p>
   {state?.mode==='PRESENTATION'&&<div className={styles.presentation}><span>Cena {state.presentation?.scene_number} · {state.presentation?.name}</span><small>{state.presentation?.playing?'Em reprodução':'Pausada'}</small></div>}
   <div className={styles.actions}>{Object.entries({start:'Iniciar apresentação',pause:'Pausar',resume:'Retomar',previous:'Anterior',next:'Próxima',reset:'Reiniciar cenas'}).map(([a,label])=><button key={a} disabled={!enabled||(a!=='start'&&state?.mode!=='PRESENTATION')} onClick={()=>void action('presentation/'+a)}>{label}</button>)}</div>
   {state?.mode==='MANUAL_DEMO'&&<div className={styles.actions}>{Object.entries({...state.manual_events,RESET:'Restaurar demo'}).map(([event,label])=><button disabled={!enabled} key={event} onClick={()=>void action('manual-demo/event',{event})}>{label}</button>)}</div>}
   <div className={styles.metrics}>{[['building_kw','Prédio'],['solar_kw','Solar'],['ev_demand_kw','EV solicitado'],['ev_served_kw','EV atendido']].map(([key,label])=><div key={key}><small>{label}</small><strong>{power(key)}</strong></div>)}</div>
   <div className={styles.slots}>{[1,2,3,4].map(n=>{const d=state?.context?.demands.find(d=>d.evse_slot===n);const v=numeric?.evse_setpoints_kw;return <div key={n}><strong>EVSE {n}</strong><span>{d?'Carregador '+d.charger_id:'Sem vínculo'}</span><small>{d?.connected?'Sessão ativa':'Sem sessão'} · {Array.isArray(v)&&v[n-1]!=null?Number(v[n-1]).toFixed(1)+' kW':'—'}</small></div>;})}</div>
   {state?.state?.primary_message&&<p className={styles.message}>{state.state.primary_message.title}: {state.state.primary_message.text}</p>}
   {frontSession.get()?.role==='admin'&&selected?.giePrimary&&<details className={styles.mapping}><summary><Settings2 size={14}/> Associações dos carregadores</summary><div className={styles.fields}><label>ID do carregador<input value={chargerId} inputMode="numeric" onChange={e=>setChargerId(e.target.value)}/></label><label>Slot<select value={slot} onChange={e=>setSlot(e.target.value)}>{[1,2,3,4].map(n=><option key={n}>{n}</option>)}</select></label><button disabled={!enabled||!/^\d+$/.test(chargerId)} onClick={()=>void action('mappings',{chargerId,evseSlot:Number(slot)})}><Link2 size={14}/> Vincular EVSE</button></div></details>}
   {(error||state?.error)&&<p className={styles.error} role="alert">{error||state?.error}</p>}
  </div>
 </details>;
}
