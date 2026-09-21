"use client";
import {useState,type FormEvent} from 'react';
import {api} from '@/services/emps-api';
export function StationRegistration({onCreated}:{onCreated:()=>void}){
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState('');
 async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const form=e.currentTarget;const data=Object.fromEntries(new FormData(form));setBusy(true);setError('');try{await api.createStation({...data,latitude:Number(data.latitude),longitude:Number(data.longitude)});setDone('Estação criada. Selecione-a ao cadastrar o carregador.');form.reset();onCreated();}catch(e){setError(e instanceof Error?e.message:'Falha ao criar estação');}finally{setBusy(false);}}
 return <details className="panel"><summary>Criar minha estação</summary><form className="provisioning-form" onSubmit={submit}>
 {Object.entries({name:'Nome',postalCode:'CEP (8 dígitos)',street:'Logradouro',addressNumber:'Número',neighborhood:'Bairro',city:'Cidade',state:'UF',latitude:'Latitude',longitude:'Longitude'}).map(([name,label])=><label key={name}>{label}<input name={name} required type={['latitude','longitude'].includes(name)?'number':'text'} step="any" maxLength={name==='state'?2:name==='postalCode'?8:80}/></label>)}
 <button className="provisioning-button" disabled={busy}>{busy?'Salvando…':'Criar estação'}</button><p role="alert">{error}</p><p role="status">{done}</p></form></details>;
}
