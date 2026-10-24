'use client';

import { useMemo } from 'react';
import { ArrowUpRight, CircleDollarSign, Info } from 'lucide-react';
import { NavigationLink } from '@/components/shell/NavigationLink';
import type { StationFinanceRecords } from '@/domain/emps';
import type { DemoHistorySummary } from '@/domain/demo-history';
import { financialToday } from '@/domain/station-insights';
import { formatCurrency } from '@/utils/formatters';
import styles from './station-dashboard.module.css';

export function StationFinancialSummary({ records, timezone, now, updatedAt, demo }: { records?: StationFinanceRecords; timezone: string; now: number; updatedAt?: number;
  demo?: { summary: DemoHistorySummary | null; from: string; to: string; sourceLabel: string } | null }) {
  const finance = useMemo(() => financialToday(records, timezone, now), [records, timezone, now]);
  const money = (value: number | null) => value === null ? 'Indisponível' : formatCurrency(value);
  const date = new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(now);
  const demoDate = demo ? `${demo.from.split('-').reverse().join('/')} – ${demo.to.split('-').reverse().join('/')}` : '';
  const primary = demo ? demo.summary?.revenueSimulated ?? null : finance.received;
  return <section className={`${styles.panel} ${styles.financePanel}`} aria-label={demo ? 'Receita e margem simuladas no período' : 'Receita e margem — hoje'}>
    <div className={styles.panelHeading}><h2><CircleDollarSign size={17} />{demo ? 'Receita e margem · SIMULATED' : 'Receita e margem — hoje'}</h2><time dateTime={demo?.to ?? finance.day}>{demo ? demoDate : date}</time></div>
    <div className={styles.receivedAmount}><span>{demo ? 'Faturamento simulado' : 'Receita recebida'} <Info size={13}><title>{demo ? 'Cenário financeiro demonstrativo. Somente sessões cobradas entram na receita; uso próprio não representa venda de energia.' : 'Pagamentos aprovados pelo backend, com data de pagamento de hoje no fuso da instalação. Pendentes, recusados e estornados não entram. Sem data ou valor confirmado, o total fica indisponível.'}</title></Info></span><strong data-unknown={primary === null}>{money(primary)}</strong><small>{demo ? demo.summary ? `${demo.summary.paidSessions ?? demo.summary.sessions} recargas cobradas · fictícias` : 'Histórico demonstrativo indisponível' : 'Pagamentos aprovados'}</small></div>
    <dl className={styles.financeMetrics}>
      <div><dt title={demo ? 'Recargas do proprietário sem venda de energia no cenário residencial.' : 'Valor das sessões encerradas hoje e com pagamento pendente ou recusado. Não representa dinheiro recebido.'}>{demo ? (demo.summary?.ownerSessions ? 'Uso próprio · sem venda' : 'Recargas cobradas') : 'Faturado em aberto'}</dt><dd>{demo ? demo.summary ? demo.summary.ownerSessions ? `${demo.summary.ownerSessions} recargas` : String(demo.summary.paidSessions ?? demo.summary.sessions) : 'Indisponível' : money(finance.outstanding)}</dd></div>
      <div><dt>{demo ? demo.summary?.ownerSessions ? 'Custo das vendas estimado' : 'Custo energético estimado' : 'Custo energético'}</dt><dd title={demo ? demo.summary?.ownerSessions ? 'Somente o custo energético estimado das recargas cobradas; o custo do uso próprio aparece abaixo.' : 'Estimativa metodológica do cenário, sem comprovação por fatura operacional.' : 'Custo validado ainda não fornecido pelo backend.'}>{demo ? money(demo.summary?.visitorEstimatedCost ?? demo.summary?.estimatedEnergyCost ?? null) : 'A calcular'}</dd></div>
      <div><dt>{demo ? 'Margem de contribuição estimada' : 'Margem operacional'}</dt><dd title={demo ? 'Receita simulada menos custo energético estimado; não representa lucro líquido.' : 'Depende do custo energético validado. Não representa lucro líquido.'}>{demo ? money(demo.summary?.estimatedContributionMargin ?? null) : 'A calcular'}</dd></div>
    </dl>
    <p className={styles.insightNote}>{demo ? demo.summary?.ownerSessions ? `Uso próprio: custo energético estimado ${money(demo.summary.ownerEstimatedCost ?? null)}; resultado após todo custo EV ${money(demo.summary.resultAfterOwnerEnergy ?? null)}. Não é lucro líquido.` : 'Margem estimada não é lucro líquido. Nenhum pagamento real foi processado.' : 'Custos e margem aguardam apuração. Solar e bateria não são tratados como energia gratuita.'}</p>
    <p className={styles.insightNote} role="status">{demo ? `${demo.sourceLabel} · datas originais · SIMULATED` : updatedAt ? `Confirmado em ${new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(updatedAt)}${now - updatedAt > 300_000 ? ' · atualização pendente' : ''}` : 'Atualização não informada'}</p>
    <div className={styles.financeFooter}><span>{timezone}</span><NavigationLink href="/payments">{demo ? 'Financeiro real' : 'Pagamentos'}<ArrowUpRight size={15} /></NavigationLink></div>
  </section>;
}
