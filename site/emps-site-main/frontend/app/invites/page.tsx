'use client';
import {useState} from 'react';
import Link from 'next/link';
import {AppShell} from '@/components/shell/AppShell';
import {api} from '@/services/emps-api';
import styles from '@/components/stations/platform.module.css';
export default function Invite(){const [status,setStatus]=useState(''),[busy,setBusy]=useState(false);async function accept(){setBusy(true);try{const token=new URLSearchParams(location.search).get('token');await api.platform('/v2/invites/accept',{method:'POST',body:JSON.stringify({token})});setStatus('Convite aceito. A estação está disponível em Minhas estações.')}catch(e){setStatus(e instanceof Error?e.message:'Convite inválido')}finally{setBusy(false)}}return <AppShell eyebrow="EMPS" title="Convite para equipe"><div className={styles.page}><section className={styles.panel}><p>Entre com a conta do e-mail convidado para aceitar o acesso à estação.</p><button disabled={busy} className={styles.primary} onClick={()=>void accept()}>Aceitar convite</button>{status&&<p role="status">{status}</p>}<Link href="/stations">Minhas estações</Link><Link href="/register">Criar conta EMPS</Link><Link href="/login">Entrar com outra conta</Link></section></div></AppShell>}
