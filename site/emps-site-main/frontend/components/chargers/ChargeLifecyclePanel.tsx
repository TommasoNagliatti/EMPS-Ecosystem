"use client";

import {useEffect,useState} from 'react';
import {Banknote,Check,Clock3,Loader2,Unplug,X} from 'lucide-react';
import {CashSessionRow,durationLabel,removalClock} from '@/domain/charge-lifecycle';
import {api,isOfficialTestBridge,isReadOnlyMode} from '@/services/emps-api';
import {formatCurrency} from '@/utils/formatters';

export function ChargeLifecyclePanel({sessions,readAt,onRefresh}:{sessions:CashSessionRow[];readAt:number;onRefresh:()=>void}){
  const [now,setNow]=useState(readAt);
  const [confirmation,setConfirmation]=useState<{id:string;kind:'removal'|'refund'}|null>(null);
  const [busy,setBusy]=useState<string|null>(null),[error,setError]=useState<string|null>(null);
  const rows=sessions.filter(s=>s.lifecycle?.stoppedAt&&(!s.lifecycle.disconnectedAt||s.lifecycle.refund?.status==='PENDING_CASH_RETURN'));
  const needsClock=rows.some(s=>!s.lifecycle?.disconnectedAt);
  useEffect(()=>{
    if(!needsClock)return;
    const timer=setInterval(()=>setNow(performance.now()),1000);return()=>clearInterval(timer);
  },[needsClock]);
  if(!rows.length)return null;
  async function confirm(row:CashSessionRow,kind:'removal'|'refund'){
    if(busy)return;
    setBusy(row.id);setError(null);
    try{
      if(kind==='removal')await api.confirmChargeRemoval(row.id);
      else await api.confirmCashRefund(row.id,Number(row.lifecycle!.refund!.dueAmount));
      setConfirmation(null);onRefresh();
    }catch(e){setError(e instanceof Error?e.message:'Nao foi possivel confirmar. Atualize antes de repetir.');}
    finally{setBusy(null);}
  }
  return <section className="charge-lifecycle-panel" aria-labelledby="charge-lifecycle-title">
    <h3 id="charge-lifecycle-title">Retirada e devolucoes</h3>
    {error&&<p role="alert" className="charge-lifecycle-error">{error}</p>}
    {rows.map(row=>{
      const lifecycle=row.lifecycle!,clock=removalClock(lifecycle,Math.max(0,now-readAt));
      const pending=lifecycle.refund?.status==='PENDING_CASH_RETURN';
      const selected=confirmation?.id===row.id?confirmation.kind:null;
      const disabled=isReadOnlyMode||isOfficialTestBridge||busy!==null;
      return <div className="charge-lifecycle-row" key={row.id}>
        <div><strong>Sessao {row.id}</strong><span>Carregador {row.chargerId}</span></div>
        <div className="charge-lifecycle-clock"><Clock3 size={16} aria-hidden="true"/><span>{clock.state==='REMOVED'?'Conector retirado':clock.state==='GRACE'?'Retirada gratuita':'Permanencia excedida'}<strong>{clock.state==='REMOVED'?'':durationLabel(clock.seconds)}</strong></span></div>
        <dl><div><dt>Consumo</dt><dd>{formatCurrency(Number(lifecycle.energyAmount))}</dd></div><div><dt>Saldo a devolver</dt><dd>{formatCurrency(Number(lifecycle.refund?.dueAmount??0))}</dd></div></dl>
        <span className="charge-lifecycle-fee">Permanencia: tarifa pendente</span>
        {Number(lifecycle.absorbedOverrunAmount??0)>0&&<span>Limite protegido; excedente em revisao</span>}
        <div className="charge-lifecycle-actions">
          {!lifecycle.disconnectedAt&&<button disabled={disabled||lifecycle.removalConfirmationMode==='gateway'} onClick={()=>setConfirmation({id:row.id,kind:'removal'})} title={lifecycle.removalConfirmationMode==='gateway'?'Aguardando retirada confirmada pelo carregador':'Confirmar conector retirado'}><Unplug size={15} aria-hidden="true"/>{lifecycle.removalConfirmationMode==='gateway'?'Aguardando carregador':'Confirmar retirada'}</button>}
          {pending&&<button disabled={disabled} onClick={()=>setConfirmation({id:row.id,kind:'refund'})} title="Registrar dinheiro devolvido pelo operador"><Banknote size={15} aria-hidden="true"/>Registrar devolucao</button>}
        </div>
        {selected&&<div className="charge-lifecycle-confirm" role="group" aria-label="Confirmacao do operador">
          <span>{selected==='refund'?`Confirma que devolveu ${formatCurrency(Number(lifecycle.refund!.dueAmount))} em dinheiro?`:'Confirma que o conector foi retirado?'}</span>
          <button disabled={busy!==null} onClick={()=>void confirm(row,selected)}>{busy===row.id?<Loader2 size={15} className="spin"/>:<Check size={15}/>}Confirmar</button>
          <button disabled={busy!==null} onClick={()=>setConfirmation(null)} aria-label="Cancelar confirmacao"><X size={15}/></button>
        </div>}
      </div>;
    })}
  </section>;
}
