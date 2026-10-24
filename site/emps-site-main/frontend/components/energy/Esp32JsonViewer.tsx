'use client';

import { useEffect, useState } from 'react';
import { api } from '@/services/emps-api';
import styles from './GieControls.module.css';

type Envelope = { snapshot:Record<string, unknown> | null; current:boolean; ack:{commandId:string; accepted:boolean} | null };
export function Esp32JsonViewer({stationId}:{stationId:string}) {
  const [data,setData]=useState<Envelope|null>(null);
  const [error,setError]=useState('');
  const [copy,setCopy]=useState('');
  useEffect(()=>{
    let active=true, busy=false; let controller:AbortController|null=null;
    setData(null);setError('');setCopy('');
    async function poll(){
      if(busy || document.visibilityState==='hidden')return;
      busy=true;controller=new AbortController();const timeout=setTimeout(()=>controller?.abort(),5000);
      try {
        const next=await api.platform<Envelope>(`/v2/stations/${encodeURIComponent(stationId)}/lab-device/energy-json`,{signal:controller.signal},{force:true});
        if(active){setData(next);setError('');}
      }catch{if(active)setError('Atualização indisponível; o JSON abaixo pode estar desatualizado.');}
      finally{clearTimeout(timeout);busy=false;}
    }
    void poll();const timer=setInterval(()=>void poll(),1000);
    return()=>{active=false;controller?.abort();clearInterval(timer);};
  },[stationId]);
  const json=data?.snapshot ? JSON.stringify(data.snapshot,null,2) : '';
  async function copyJson(){
    try{
      if(navigator.clipboard && window.isSecureContext)await navigator.clipboard.writeText(json);
      else { const field=document.createElement('textarea');field.value=json;field.style.position='fixed';field.style.opacity='0';document.body.appendChild(field);
        try{field.select();if(!document.execCommand('copy'))throw Error('copy');}finally{field.remove();}}
      setCopy('JSON copiado.');
    }catch{setCopy('Não foi possível copiar. Selecione o texto e copie manualmente.');}
  }
  return <details className={styles.panel} open>
    <summary className={styles.summary}><span className={styles.heading}><strong>JSON GIE → ESP32</strong><small>Snapshot completo · SIMULATED · atualização a cada segundo</small></span></summary>
    <div className={styles.body}>
      <p className={styles.hint}>{!json ? 'Aguardando o primeiro snapshot transmitido ao dispositivo.' : error || !data?.current ? 'Último snapshot transmitido · expirado ou conexão indisponível.' : 'Snapshot atual transmitido pela ponte.'} {data?.ack?.commandId===data?.snapshot?.commandId ? (data?.ack?.accepted ? 'ACK aceito pelo dispositivo.' : 'Dispositivo recusou o snapshot.') : json ? 'Sem ACK deste snapshot.' : ''}</p>
      {error && <p className={styles.error} role="status">{error}</p>}
      <div className={styles.actions}><button type="button" disabled={!json} onClick={()=>void copyJson()}>Copiar JSON completo</button><span role="status">{copy}</span></div>
      {json && <pre tabIndex={0} aria-label="JSON completo enviado ao ESP32" style={{margin:0,maxHeight:520,overflow:'auto',whiteSpace:'pre',fontSize:12,lineHeight:1.6}}>{json}</pre>}
    </div>
  </details>;
}
