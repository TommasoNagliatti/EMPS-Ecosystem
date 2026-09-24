"use client";
import { FormEvent, useEffect, useRef, useState } from 'react';
import { api } from '@/services/emps-api';

export function CreateAdminForm() {
  const [allowed,setAllowed]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const submitting=useRef(false);
  useEffect(()=>{let active=true;void api.ensureSession().then(user=>{if(active)setAllowed(String(user.role).toLowerCase()==='admin');}).catch(()=>undefined);return()=>{active=false;};},[]);
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(submitting.current)return;
    const form=event.currentTarget,data=new FormData(form);submitting.current=true;setBusy(true);setMessage('');
    try {await api.createAdmin({name:String(data.get('name')),email:String(data.get('email')),password:String(data.get('password'))});form.reset();setMessage('Administrador criado. Ele terá acesso apenas às estações atribuídas à sua conta.');}
    catch(e){setMessage(e instanceof Error?e.message:'Não foi possível criar o administrador.');}
    finally{submitting.current=false;setBusy(false);}
  }
  if(!allowed)return null;
  return <section className="setting-card"><h2>Novo administrador</h2><p>Somente administradores podem cadastrar outra conta administrativa.</p><form onSubmit={submit} style={{display:'grid',gap:12,maxWidth:420}}>
    <label>Nome<input name="name" required minLength={2} maxLength={100} autoComplete="off" /></label>
    <label>E-mail<input name="email" type="email" required autoComplete="off" /></label>
    <label>Senha inicial<input name="password" type="password" required minLength={12} maxLength={72} autoComplete="new-password" /></label>
    <button type="submit" disabled={busy}>{busy?'Criando…':'Criar administrador'}</button><p role="status">{message}</p>
  </form></section>;
}
