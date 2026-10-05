'use client';
import {useEffect,useRef,useState} from 'react';
import {loadStripe,type Stripe,type StripeCardElement} from '@stripe/stripe-js';

export function StripeCard({clientSecret,publishableKey,onConfirmed}:{clientSecret:string;publishableKey?:string;onConfirmed:()=>Promise<void>}){
 const mount=useRef<HTMLDivElement>(null),stripe=useRef<Stripe|null>(null),card=useRef<StripeCardElement|null>(null);
 const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let alive=true;setReady(false);setError('');
  if(!publishableKey?.startsWith('pk_test_')){setError('Cartão indisponível: chave pública Stripe Sandbox não configurada.');return}
  const timer=setTimeout(()=>{if(alive)setError('Formulário do cartão indisponível neste navegador. Escolha outro meio ou abra em um navegador compatível.')},15000);
  void loadStripe(publishableKey).then(client=>{if(!alive||!mount.current)return;if(!client)throw Error('Não foi possível carregar o Stripe');stripe.current=client;const element=client.elements().create('card',{hidePostalCode:true,style:{base:{color:'#eef4fc',fontSize:'16px','::placeholder':{color:'#99abc3'}}}});card.current=element;element.mount(mount.current);element.on('ready',()=>{clearTimeout(timer);if(alive){setReady(true);setError('')}});element.on('change',e=>{if(alive)setError(e.error?.message??'')})}).catch(e=>{if(alive)setError(e.message)});
  return()=>{alive=false;clearTimeout(timer);card.current?.destroy();card.current=null;stripe.current=null};
 },[publishableKey,clientSecret]);
 async function confirm(){if(!stripe.current||!card.current||busy)return;setBusy(true);setError('');try{const result=await stripe.current.confirmCardPayment(clientSecret,{payment_method:{card:card.current}});if(result.error)throw Error(result.error.message??'Cartão recusado. Tente novamente.');await onConfirmed()}catch(e){setError(e instanceof Error?e.message:'Não foi possível confirmar o cartão')}finally{setBusy(false)}}
 return <div><p>Cartão Stripe Sandbox · somente dados de teste</p><div ref={mount} style={{padding:16,border:'1px solid #41506a',borderRadius:10,margin:'12px 0'}}/>{error&&<p role="alert">{error}</p>}<button disabled={!ready||busy} onClick={confirm}>{busy?'Confirmando…':'Confirmar autorização do cartão'}</button><p>Os dados do cartão são enviados diretamente ao Stripe.</p></div>;
}
