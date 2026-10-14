'use client';
import {authReturnPath} from '@/services/auth-return';
import {FormEvent,useEffect,useRef,useState} from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {Moon, Sun} from 'lucide-react';
import {api} from '@/services/emps-api';
import {useTheme} from '@/components/theme/ThemeProvider';
export default function RegisterPage(){
 const router=useRouter();const [nextPath,setNextPath]=useState('/stations');useEffect(()=>setNextPath(authReturnPath()),[]);const [name,setName]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[confirmation,setConfirmation]=useState(''),[terms,setTerms]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');const submitting=useRef(false);
 const {theme,setTheme}=useTheme();
 async function submit(e:FormEvent){e.preventDefault();if(submitting.current)return;if(password!==confirmation){setError('As senhas precisam ser iguais.');return}submitting.current=true;setBusy(true);setError('');try{await api.register({name,email,password,passwordConfirmation:confirmation,acceptTerms:terms});router.replace(authReturnPath())}catch(e){setError(e instanceof Error?e.message:'Não foi possível criar a conta')}finally{setBusy(false);submitting.current=false}}
 return (
  <main className="login-screen login-screen--sems login-screen--register" data-theme={theme}>
   <section className="login-visual" aria-label="Energia e mobilidade EMPS">
    <Image src="/goodwe_logo.eb050bb6.png" alt="GoodWe" width={280} height={42} className="login-brand" priority/>
   </section>
   <section className="login-panel" aria-label="Criar conta EMPS">
    <button className="login-theme-switch" type="button" aria-label={theme==='dark'?'Ativar tema claro':'Ativar tema escuro'} onClick={()=>setTheme(theme==='dark'?'light':'dark')}>
     {theme==='dark'?<Sun size={20}/>:<Moon size={20}/>}
    </button>
    <form className="login-card" onSubmit={submit} aria-busy={busy}>
     <h1>Sua conta EMPS</h1>
     <p>Uma conta para o Site, o App e suas recargas.</p>
     <div className="login-fields">
      <label htmlFor="name">Nome</label>
      <input id="name" autoComplete="name" placeholder="Nome" required minLength={2} maxLength={100} value={name} onChange={e=>setName(e.target.value)}/>
      <label htmlFor="email">E-mail</label>
      <input id="email" type="email" autoComplete="email" placeholder="E-mail" required value={email} onChange={e=>setEmail(e.target.value)}/>
      <label htmlFor="password">Senha</label>
      <input id="password" type="password" autoComplete="new-password" placeholder="Senha (mínimo de 8 caracteres)" minLength={8} maxLength={72} required value={password} onChange={e=>setPassword(e.target.value)}/>
      <label htmlFor="confirmation">Confirme a senha</label>
      <input id="confirmation" type="password" autoComplete="new-password" placeholder="Confirme a senha" minLength={8} maxLength={72} required value={confirmation} onChange={e=>setConfirmation(e.target.value)}/>
     </div>
     <label className="login-check"><input type="checkbox" required checked={terms} onChange={e=>setTerms(e.target.checked)}/><span>Li e aceito os Termos de Uso e a Política de Privacidade do EMPS.</span></label>
     {error&&<p className="login-error" role="alert">{error}</p>}
     <button className="login-submit" disabled={busy}>{busy?'Criando conta…':'Criar conta'}</button>
     <footer className="login-footer">Já tem conta? <Link href={"/login?next="+encodeURIComponent(nextPath)}>Entrar</Link></footer>
    </form>
   </section>
  </main>
 );
}
