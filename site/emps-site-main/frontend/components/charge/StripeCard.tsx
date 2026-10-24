"use client";
import { useEffect, useRef, useState } from 'react';
import { loadStripe, type Stripe, type StripeCardNumberElement } from '@stripe/stripe-js';
import { CreditCard, LockKeyhole } from 'lucide-react';
import styles from './charge.module.css';

export function StripeCard({ clientSecret, publishableKey, onConfirmed }: {
  clientSecret: string; publishableKey?: string; onConfirmed: () => Promise<void>;
}) {
  const numberMount = useRef<HTMLDivElement>(null), expiryMount = useRef<HTMLDivElement>(null), cvcMount = useRef<HTMLDivElement>(null);
  const stripe = useRef<Stripe | null>(null), card = useRef<StripeCardNumberElement | null>(null), submitting = useRef(false);
  const [ready, setReady] = useState(false), [complete, setComplete] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const cleanup: (() => void)[] = [];
    setReady(false); setComplete(false); setError('');
    if (!publishableKey?.startsWith('pk_test_')) { setError('Cartão indisponível: configuração de teste não recebida. Atualize a página.'); return; }
    const timer = setTimeout(() => { if (alive) setError('Não foi possível carregar os campos seguros. Verifique sua conexão ou bloqueador de conteúdo.'); }, 15000);
    void loadStripe(publishableKey).then(client => {
      if (!alive) return;
      if (!client || !numberMount.current || !expiryMount.current || !cvcMount.current) throw Error('Não foi possível carregar o formulário seguro.');
      stripe.current = client;
      const elements = client.elements({ locale: 'pt-BR' });
      const style = { base: { color: '#eef4fc', fontSize: '16px', fontFamily: 'system-ui, sans-serif', '::placeholder': { color: '#8394ad' } }, invalid: { color: '#ff9aa8' } };
      const number = elements.create('cardNumber', { style, showIcon: true });
      const expiry = elements.create('cardExpiry', { style });
      const cvc = elements.create('cardCvc', { style });
      card.current = number;
      const done = [false, false, false], loaded = [false, false, false], errors = ['', '', ''];
      const readyField = (index: number) => { loaded[index] = true; if (alive && loaded.every(Boolean)) { clearTimeout(timer); setReady(true); } };
      const changed = (index: number, event: { complete: boolean; error?: { message: string } }) => { done[index] = event.complete; errors[index] = event.error?.message ?? ''; if (alive) { setComplete(done.every(Boolean)); setError(errors.find(Boolean) ?? ''); } };
      cleanup.push(() => number.destroy(), () => expiry.destroy(), () => cvc.destroy());
      number.on('ready', () => readyField(0)); expiry.on('ready', () => readyField(1)); cvc.on('ready', () => readyField(2));
      number.on('change', event => changed(0, event)); expiry.on('change', event => changed(1, event)); cvc.on('change', event => changed(2, event));
      number.mount(numberMount.current); expiry.mount(expiryMount.current); cvc.mount(cvcMount.current);
    }).catch(e => { clearTimeout(timer); if (alive) setError(e instanceof Error ? e.message : 'Formulário indisponível.'); });
    return () => { alive = false; clearTimeout(timer); cleanup.forEach(fn => fn()); card.current = null; stripe.current = null; };
  }, [publishableKey, clientSecret]);
  async function confirm() {
    if (!stripe.current || !card.current || !complete || submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      const result = await stripe.current.confirmCardPayment(clientSecret, { payment_method: { card: card.current } });
      if (result.error) throw Error(result.error.message ?? 'Cartão recusado. Tente novamente.');
      if (!['requires_capture', 'succeeded'].includes(result.paymentIntent?.status ?? '')) throw Error('Autorização ainda não confirmada. Tente novamente.');
      await onConfirmed();
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível confirmar o cartão.'); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <section className={styles.paymentPanel} aria-label="Cartão de teste" aria-busy={busy}>
    <div className={styles.paymentHeading}><CreditCard size={20}/><strong>Cartão de crédito</strong><span>TESTE</span></div>
    <p className={styles.muted}>Autorize o limite escolhido. O valor utilizado será confirmado ao encerrar a recarga.</p>
    {!ready && !error && <p role="status">Carregando campos seguros…</p>}
    <div className={styles.stripeField}><span>Número do cartão</span><div ref={numberMount}/></div>
    <div className={styles.cardFields}>
      <div className={styles.stripeField}><span>Validade</span><div ref={expiryMount}/></div>
      <div className={styles.stripeField}><span>Código de segurança</span><div ref={cvcMount}/></div>
    </div>
    {error && <p className={styles.paymentError} role="alert">{error}</p>}
    <button type="button" className={styles.primary} disabled={!ready || !complete || busy} onClick={confirm}>{busy ? 'Confirmando autorização…' : 'Confirmar cartão e continuar'}</button>
    <p className={styles.secureNote}><LockKeyhole size={14}/> Dados protegidos pelo Stripe. Use somente cartão de teste.</p>
  </section>;
}
