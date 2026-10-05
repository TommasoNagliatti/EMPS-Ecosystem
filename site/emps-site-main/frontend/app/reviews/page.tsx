'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {AppShell} from '@/components/shell/AppShell';
import {api} from '@/services/emps-api';
import {StationSummary} from '@/components/stations/StationSummary';
import {draftFrom,emptyDraft,Station} from '@/components/stations/station-types';
import styles from '@/components/stations/platform.module.css';
type Review={id:string;station:Station;proposedConfig:Record<string,unknown>;createdAt:string};
export default function Reviews(){
 const [rows,setRows]=useState<Review[]>([]),[reason,setReason]=useState<Record<string,string>>({}),[demo,setDemo]=useState<Record<string,boolean>>({}),[canDemo,setCanDemo]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const load=()=>api.platform<Review[]>('/v2/reviews').then(setRows);
 useEffect(()=>{void load().catch(e=>setError(e.message)).finally(()=>setLoading(false));void api.platform<{presentationTools:boolean}>('/auth/me').then(u=>setCanDemo(u.presentationTools)).catch(()=>undefined)},[]);
 async function decide(r:Review,decision:string){setBusy(true);setError('');try{await api.platform('/v2/reviews/'+r.id,{method:'POST',body:JSON.stringify({decision,reason:reason[r.id]||'',activateDemoChargers:decision==='APPROVED'&&!!demo[r.id]})});await load()}catch(e){setError(e instanceof Error?e.message:'Não foi possível decidir')}finally{setBusy(false)}}
 return <AppShell eyebrow="EMPS / Plataforma" title="Revisão de estações" description="Valide a configuração antes de permitir a operação."><div className={styles.page}><Link href="/stations">← Minhas estações</Link>{error&&<p className={styles.error} role="alert">{error}</p>}{loading&&<p role="status">Carregando revisões…</p>}{!loading&&rows.length===0&&!error&&<p className={styles.notice}>Nenhuma revisão pendente.</p>}{rows.map(r=>{const draft=r.station.technicalReviewRequired?{...draftFrom(r.station),...r.proposedConfig}:draftFrom(r.proposedConfig as Station);return <article className={styles.panel} key={r.id}><h2>{r.station.name}</h2><span className={styles.tag}>{r.station.technicalReviewRequired?'Alteração técnica · configuração atual preservada':'Nova estação'}</span><StationSummary draft={draft}/><label>Motivo da decisão<textarea required minLength={3} maxLength={1000} value={reason[r.id]??''} onChange={e=>setReason(v=>({...v,[r.id]:e.target.value}))}/></label>{canDemo&&<label className={styles.check}><input type="checkbox" checked={!!demo[r.id]} onChange={e=>setDemo(v=>({...v,[r.id]:e.target.checked}))}/>Ativar carregadores pendentes em DEMO (sem conexão física, tarifa obrigatória)</label>}<div className={styles.actions}><button disabled={busy||(reason[r.id]?.trim().length??0)<3} className={styles.primary} onClick={()=>void decide(r,'APPROVED')}>Aprovar</button><button disabled={busy||(reason[r.id]?.trim().length??0)<3} onClick={()=>void decide(r,'CHANGES_REQUESTED')}>Solicitar correção</button><button disabled={busy||(reason[r.id]?.trim().length??0)<3} onClick={()=>void decide(r,'REJECTED')}>Rejeitar</button></div></article>})}</div></AppShell>;
}
