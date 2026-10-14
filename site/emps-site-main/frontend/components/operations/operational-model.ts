import type { Alert, ApiResource, ChargingSession, Client, Payment, ResourceRow } from '@/domain/emps';

export type Period = 'all' | 'day' | 'week' | 'month' | 'custom';
export type DateRange = { from: string; to: string };
export type SortOrder = 'recent' | 'oldest' | 'name' | 'amount' | 'priority';
export type SummaryMetric = { label: string; value: number; format?: 'currency' | 'energy'; tone?: 'green' | 'blue' | 'red' | 'amber' };

export function searchText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

export function displayReference(value: string | null) {
  return !value || value.endsWith('-sem-id') ? 'Não associado' : value;
}

function dateInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function periodRange(period: Period, custom: DateRange, now = new Date()): DateRange {
  if (period === 'all') return { from: '', to: '' };
  if (period === 'custom') return custom;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'week') start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  if (period === 'month') start.setDate(1);
  return { from: dateInput(start), to: dateInput(now) };
}

export function rowDate(row: ResourceRow) {
  if ('dataInicio' in row) return row.dataInicio;
  if ('dataPagamento' in row) return row.dataPagamento;
  if ('dataCriacao' in row) return row.dataCriacao;
  if ('criadoEm' in row) return row.criadoEm;
  return null;
}

export function matchesDate(row: ResourceRow, range: DateRange) {
  if (!range.from && !range.to) return true;
  if (range.from && range.to && range.from > range.to) return false;
  const raw = rowDate(row);
  const stamp = raw ? new Date(raw).getTime() : NaN;
  if (!Number.isFinite(stamp)) return false;
  return (!range.from || stamp >= new Date(`${range.from}T00:00:00`).getTime()) &&
    (!range.to || stamp <= new Date(`${range.to}T23:59:59.999`).getTime());
}

export function matchesStatus(resource: ApiResource, row: ResourceRow, filter: string) {
  if (filter === 'todos') return true;
  if (resource === 'alertas' && filter === 'critica') return (row as Alert).severidade === 'critica';
  return row.status === filter;
}

export function matchesSearch(row: ResourceRow, query: string) {
  const term = searchText(query);
  return !term || searchText(Object.values(row).filter(value => value != null).join(' ')).includes(term);
}

export function pageSlice<T>(rows: T[], page: number, size = 25) {
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const currentPage = Math.max(1, Math.min(page, pageCount));
  return { pageCount, currentPage, rows: rows.slice((currentPage - 1) * size, currentPage * size),
    first: rows.length ? (currentPage - 1) * size + 1 : 0, last: Math.min(currentPage * size, rows.length) };
}

export function sortRows(rows: ResourceRow[], order: SortOrder) {
  const severity: Record<string, number> = { critica: 4, alta: 3, media: 2, baixa: 1 };
  return [...rows].sort((a, b) => {
    if (order === 'priority' && 'severidade' in a && 'severidade' in b) {
      const unresolved = Number(b.status !== 'resolvido') - Number(a.status !== 'resolvido');
      const difference = severity[b.severidade] - severity[a.severidade];
      if (unresolved || difference) return unresolved || difference;
    }
    if (order === 'name') {
      const name = (row: ResourceRow) => 'nome' in row ? row.nome : 'usuarioNome' in row ? row.usuarioNome : 'titulo' in row ? row.titulo : '';
      return name(a).localeCompare(name(b), 'pt-BR', { sensitivity: 'base' });
    }
    if (order === 'amount' && 'valorTotal' in a && 'valorTotal' in b) return b.valorTotal - a.valorTotal;
    const rawA = rowDate(a), rawB = rowDate(b);
    const dateA = rawA ? new Date(rawA).getTime() : NaN, dateB = rawB ? new Date(rawB).getTime() : NaN;
    if (!Number.isFinite(dateA)) return Number.isFinite(dateB) ? 1 : 0;
    if (!Number.isFinite(dateB)) return -1;
    return order === 'oldest' ? dateA - dateB : dateB - dateA;
  });
}

function sum<T>(rows: T[], value: (row: T) => number) {
  return rows.reduce((total, row) => total + (Number.isFinite(value(row)) ? value(row) : 0), 0);
}

export function resourceSummary(resource: ApiResource, rows: ResourceRow[]): SummaryMetric[] {
  if (resource === 'sessoes') {
    const sessions = rows as ChargingSession[];
    return [{ label: 'Sessões', value: rows.length }, { label: 'Em recarga', value: sessions.filter(row => row.status === 'ativa').length, tone: 'blue' },
      { label: 'Energia entregue', value: sum(sessions, row => row.energiaKwh), format: 'energy', tone: 'green' },
      { label: 'Aguardando pagamento', value: sessions.filter(row => row.status === 'aguardando_pagamento').length, tone: 'amber' }];
  }
  if (resource === 'pagamentos') {
    const payments = rows as Payment[];
    return [{ label: 'Transações', value: rows.length },
      { label: 'Aprovado', value: sum(payments.filter(row => row.status === 'aprovado'), row => row.valorTotal), format: 'currency', tone: 'green' },
      { label: 'Pendente', value: sum(payments.filter(row => row.status === 'pendente'), row => row.valorTotal), format: 'currency', tone: 'amber' },
      { label: 'Estornado', value: sum(payments.filter(row => row.status === 'estornado'), row => row.valorTotal), format: 'currency', tone: 'red' }];
  }
  if (resource === 'clientes') {
    const clients = rows as Client[];
    return [{ label: 'Clientes', value: rows.length }, { label: 'Ativos', value: clients.filter(row => row.status === 'ativo').length, tone: 'green' },
      { label: 'Com recargas', value: clients.filter(row => row.totalSessoes > 0).length, tone: 'blue' },
      { label: 'Recargas realizadas', value: sum(clients, row => row.totalSessoes) }];
  }
  if (resource === 'alertas') {
    const alerts = rows as Alert[];
    return [{ label: 'Alertas', value: rows.length }, { label: 'Em aberto', value: alerts.filter(row => row.status === 'aberto').length, tone: 'amber' },
      { label: 'Críticos não resolvidos', value: alerts.filter(row => row.severidade === 'critica' && row.status !== 'resolvido').length, tone: 'red' },
      { label: 'Resolvidos', value: alerts.filter(row => row.status === 'resolvido').length, tone: 'green' }];
  }
  return [{ label: 'Carregadores', value: rows.length }];
}
