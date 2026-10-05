'use client';
import {useEffect,useMemo,useState} from 'react';
import {useRouter} from 'next/navigation';
import Link from 'next/link';
import {Building2,Plus,Search} from 'lucide-react';
import {AppShell} from '@/components/shell/AppShell';
import {api,selectedStation} from '@/services/emps-api';
import {StationPhoto} from './StationPhoto';
import {Station,reviewLabels} from './station-types';
import styles from './platform.module.css';
const filters=['Todas','Ativas','Rascunhos','Aguardando validação','Privadas','Públicas','Com problema'];
export function StationList(){
 const router=useRouter();const [rows,setRows]=useState<Station[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[query,setQuery]=useState(''),[filter,setFilter]=useState('Todas'),[reviewer,setReviewer]=useState(false);
 useEffect(()=>{let alive=true;void Promise.all([api.platform<Station[]>('/v2/stations'),api.platform<{platformReviewer:boolean}>('/auth/me')]).then(([stations,user])=>{if(alive){setRows(stations);setReviewer(user.platformReviewer)}}).catch(e=>{if(alive)setError(e.message)}).finally(()=>{if(alive)setLoading(false)});return()=>{alive=false}},[]);
 const visible=useMemo(()=>rows.filter(s=>(s.name+' '+s.street+' '+s.city+' '+s.state).toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR'))).filter(s=>filter==='Todas'||filter==='Ativas'&&s.status==='ACTIVE'||filter==='Rascunhos'&&s.reviewState==='DRAFT'||filter==='Aguardando validação'&&(s.reviewState==='PENDING_REVIEW'||s.technicalReviewRequired)||filter==='Privadas'&&s.visibility==='PRIVATE'||filter==='Públicas'&&s.visibility==='PUBLIC'||filter==='Com problema'&&['REJECTED','SUSPENDED','CHANGES_REQUESTED'].includes(s.reviewState)),[rows,query,filter]);
 return <AppShell eyebrow="EMPS" title="Minhas estações" description="Seus locais, equipamentos e equipes em um só lugar."><div className={styles.page}>
  <div className={styles.toolbar}><label className={styles.search}><span><Search size={14}/> Buscar nome ou endereço</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Encontre uma estação"/></label><div className={styles.actions}>{reviewer&&<Link className={styles.button} href="/reviews">Revisões da plataforma</Link>}<Link className={`${styles.button} ${styles.primary}`} href="/stations/new"><Plus size={15}/> Nova estação</Link></div></div>
  <nav className={styles.filters} aria-label="Filtrar estações">{filters.map(f=><button key={f} aria-pressed={filter===f} className={filter===f?styles.active:''} onClick={()=>setFilter(f)}>{f}</button>)}</nav>
  {error&&<p className={styles.error} role="alert">{error}</p>}{loading?<p role="status">Carregando suas estações…</p>:rows.length===0&&!error?<div className={styles.empty}><Building2 size={42}/><h2>Você ainda não possui estações.</h2><p className={styles.muted}>Comece com um rascunho. Você pode completar os dados depois.</p><Link className={`${styles.button} ${styles.primary}`} href="/stations/new">+ Criar nova estação</Link></div>:<div className={styles.cards}>{visible.map(s=><article className={styles.card} key={s.id}><StationPhoto id={s.photos[0]?.id} alt={s.name}/><div className={styles.cardBody}><div className={styles.row}><span className={styles.tag}>{reviewLabels[s.reviewState]??s.reviewState}</span><span className={styles.tag}>{s.visibility==='PUBLIC'?'Pública':'Privada'}</span></div><h3>{s.name}</h3><p className={styles.muted}>{s.street?s.street+', '+s.addressNumber+' · '+s.city+'/'+s.state:'Localização a completar'}</p><small>{s._count?.chargers??0} carregadores · {s.membershipRole}</small><small className={styles.muted}>{s.gieStatus==='DEMO_CONNECTED'?'GIE de demonstração conectado':s.gieStatus==='BASE_PROVISIONED'?'GIE Base preparado · integração V2 pendente':'GIE ainda não provisionado'}</small>{s.technicalReviewRequired&&<span className={styles.tag}>Revisão técnica pendente</span>}<div className={styles.actions}><button onClick={()=>{selectedStation.set(s.id);router.push(s.status==='ACTIVE'?'/dashboard':'/stations/'+s.id)}}>{s.status==='ACTIVE'?'Abrir painel':'Continuar rascunho'}</button><Link href={'/stations/'+s.id} className={styles.button}>Configurações</Link></div></div></article>)}</div>}
  {!loading&&rows.length>0&&visible.length===0&&<p className={styles.muted}>Nenhuma estação corresponde aos filtros.</p>}
 </div></AppShell>;
}
