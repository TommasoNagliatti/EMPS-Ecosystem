'use client';

import { useMemo } from 'react';
import { ArrowUpRight, CircleDollarSign, Info } from 'lucide-react';
import { NavigationLink } from '@/components/shell/NavigationLink';
import type { StationFinanceRecords } from '@/domain/emps';
import { financialToday } from '@/domain/station-insights';
import { formatCurrency } from '@/utils/formatters';
import styles from './station-dashboard.module.css';

export function StationFinancialSummary({ records, timezone, now, updatedAt }: { records?: StationFinanceRecords; timezone: string; now: number; updatedAt?: number }) {
  const finance = useMemo(() => financialToday(records, timezone, now), [records, timezone, now]);
  const money = (value: number | null) => value === null ? 'Indisponível' : formatCurrency(value);
  const date = new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(now);
  return <section className={`${styles.panel} ${styles.financePanel}`} aria-label="Receita e margem — hoje">
    <div className={styles.panelHeading}><h2><CircleDollarSign size={17} />Receita e margem — hoje</h2><time dateTime={finance.day}>{date}</time></div>
    <div className={styles.receivedAmount}><span>Receita recebida <Info size={13}><title>Pagamentos aprovados pelo backend, com data de pagamento de hoje no fuso da instalação. Pendentes, recusados e estornados não entram. Sem data ou valor confirmado, o total fica indisponível.</title></Info></span><strong data-unknown={finance.received === null}>{money(finance.received)}</strong><small>Pagamentos aprovados</small></div>
    <dl className={styles.financeMetrics}>
      <div><dt title="Valor das sessões encerradas hoje e com pagamento pendente ou recusado. Não representa dinheiro recebido.">Faturado em aberto</dt><dd>{money(finance.outstanding)}</dd></div>
      <div><dt>Custo energético</dt><dd title="Custo validado ainda não fornecido pelo backend.">A calcular</dd></div>
      <div><dt>Margem operacional</dt><dd title="Depende do custo energético validado. Não representa lucro líquido.">A calcular</dd></div>
    </dl>
    <p className={styles.insightNote}>Custos e margem aguardam apuração. Solar e bateria não são tratados como energia gratuita.</p>
    <p className={styles.insightNote} role="status">{updatedAt ? `Confirmado em ${new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(updatedAt)}${now - updatedAt > 300_000 ? ' · atualização pendente' : ''}` : 'Atualização não informada'}</p>
    <div className={styles.financeFooter}><span>{timezone}</span><NavigationLink href="/payments">Pagamentos<ArrowUpRight size={15} /></NavigationLink></div>
  </section>;
}
