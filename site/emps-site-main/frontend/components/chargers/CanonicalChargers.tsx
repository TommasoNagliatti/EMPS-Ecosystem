'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {QRCodeSVG} from 'qrcode.react';
import {api} from '@/services/emps-api';

type Charger={id:number;name:string;stationId:number;ocppIdentity:string;powerKw:string;connectorType:string;administrativeStatus:string;station:{id:number;name:string;reviewState:string|null};qrBindings:{id:string;publicToken:string}[]};
export function CanonicalChargers(){
 const [stations,setStations]=useState<Charger['station'][]>([]);
 const [rows,setRows]=useState<Charger[]>([]),[station,setStation]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(true),[selected,setSelected]=useState<Charger|null>(null),[busy,setBusy]=useState(false);
 async function load(){setError('');try{const [chargers,availableStations]=await Promise.all([api.platform<Charger[]>('/v2/chargers'),api.platform<Charger['station'][]>('/v2/stations')]);setRows(chargers);setStations(availableStations)}catch(e){setError(e instanceof Error?e.message:'Não foi possível carregar')}finally{setLoading(false)}}
 useEffect(()=>{void load()},[]);
 const visible=rows.filter(c=>!station||String(c.stationId)===station);
 async function qr(c:Charger){setError('');setBusy(true);try{const binding=c.qrBindings[0]??await api.platform<Charger['qrBindings'][number]>('/v2/chargers/'+c.id+'/qr',{method:'POST'});const updated={...c,qrBindings:[binding]};setRows(r=>r.map(x=>x.id===c.id?updated:x));setSelected(updated)}catch(e){setError(e instanceof Error?e.message:'QR indisponível')}finally{setBusy(false)}}
 const url=selected?.qrBindings[0]?window.location.origin+'/charge/'+encodeURIComponent(selected.qrBindings[0].publicToken):'';
 return <section className="panel" style={{padding:20,marginBottom:20}} aria-label="Carregadores cadastrados">
  <h2>Carregadores da estação</h2><p>Equipamentos cadastrados no EMPS, incluindo rascunhos. Operação depende da aprovação e ativação.</p>
  <label>Estação <select value={station} onChange={e=>setStation(e.target.value)}><option value="">Todas as minhas estações</option>{stations.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>{' '}<button onClick={()=>void load()}>Atualizar carregadores</button>
  {error&&<p role="alert">{error}</p>}{loading?<p role="status">Carregando…</p>:<><p>{visible.length} carregadores</p><div style={{overflowX:'auto'}}><table><thead><tr><th>Carregador</th><th>Estação</th><th>Identidade OCPP</th><th>Potência / conector</th><th>Status</th><th>QR</th></tr></thead><tbody>{visible.map(c=><tr key={c.id}><td>{c.name} · #{c.id}</td><td><Link href={'/stations/'+c.stationId}>{c.station.name}</Link></td><td>{c.ocppIdentity}</td><td>{Number(c.powerKw)} kW · {c.connectorType}</td><td>{c.administrativeStatus}</td><td><button disabled={busy||c.administrativeStatus==='DISABLED'} onClick={()=>void qr(c)}>Ver QR · {c.name}</button></td></tr>)}</tbody></table></div></>}
  {selected&&<div role="region" aria-label={'QR '+selected.name} style={{marginTop:20}}><h3>{selected.name} · #{selected.id}</h3><QRCodeSVG value={url} size={180} bgColor="#ffffff" fgColor="#000000" marginSize={4}/><p><a href={url} target="_blank" rel="noreferrer">Abrir Web Charge · {selected.name}</a></p><p>O QR identifica este carregador. Estações em rascunho ou equipamentos inativos não permitem recarga.</p><button onClick={()=>setSelected(null)}>Fechar QR</button></div>}
 </section>;
}
