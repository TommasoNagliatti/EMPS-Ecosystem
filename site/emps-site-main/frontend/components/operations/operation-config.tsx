import {
  AlertTriangle,
  BatteryCharging,
  CreditCard,
  PlugZap,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { StatusBadge } from "@/components/status/StatusBadge";
import type {
  Alert,
  ApiResource,
  Charger,
  ChargingSession,
  Client,
  Payment,
  ResourceRow,
} from "@/domain/emps";
import {
  formatCurrency,
  formatDateTime,
  formatKwh,
  formatKw,
  formatMinutes,
  normalizeText,
} from "@/utils/formatters";

export type ResourceConfig = {
  title: string;
  eyebrow: string;
  description: string;
  searchPlaceholder: string;
  icon: LucideIcon;
  filters: Array<{ label: string; value: string }>;
};

export type OperationColumn = {
  label: string;
  className?: string;
  render: (row: ResourceRow) => ReactNode;
};

export const operationConfigs: Record<ApiResource, ResourceConfig> = {
  carregadores: {
    title: "Carregadores",
    eyebrow: "EMPS / Infraestrutura",
    description: "Equipamentos e disponibilidade de recarga.",
    searchPlaceholder: "Buscar carregador, instalação ou identidade OCPP",
    icon: PlugZap,
    filters: [
      { label: "Todos", value: "todos" },
      { label: "Disponíveis", value: "disponivel" },
      { label: "Em uso", value: "em_uso" },
      { label: "Offline", value: "offline" },
      { label: "Manutenção", value: "manutencao" },
    ],
  },
  sessoes: {
    title: "Sessões",
    eyebrow: "EMPS / Operacao",
    description: "Acompanhe as recargas e consulte o histórico de cada sessão.",
    searchPlaceholder: "Buscar ID da sessão, cliente ou carregador",
    icon: BatteryCharging,
    filters: [
      { label: "Todas", value: "todos" },
      { label: "Ativas", value: "ativa" },
      { label: "Finalizadas", value: "finalizada" },
      { label: "Aguardando pagamento", value: "aguardando_pagamento" },
      { label: "Canceladas", value: "cancelada" },
    ],
  },
  pagamentos: {
    title: "Pagamentos",
    eyebrow: "EMPS / Financeiro",
    description: "Consulte transações, valores e situações de pagamento.",
    searchPlaceholder: "Buscar ID do pagamento, sessão ou cliente",
    icon: CreditCard,
    filters: [
      { label: "Todos", value: "todos" },
      { label: "Aprovados", value: "aprovado" },
      { label: "Pendentes", value: "pendente" },
      { label: "Recusados", value: "recusado" },
      { label: "Estornados", value: "estornado" },
    ],
  },
  alertas: {
    title: "Alertas",
    eyebrow: "EMPS / Confiabilidade",
    description: "Priorize ocorrências e acompanhe a situação dos equipamentos.",
    searchPlaceholder: "Buscar alerta, equipamento ou origem",
    icon: AlertTriangle,
    filters: [
      { label: "Todos", value: "todos" },
      { label: "Abertos", value: "aberto" },
      { label: "Verificando", value: "verificando" },
      { label: "Resolvidos", value: "resolvido" },
      { label: "Críticos", value: "critica" },
    ],
  },
  clientes: {
    title: "Clientes",
    eyebrow: "EMPS / Relacionamento",
    description: "Consulte clientes, veículos e histórico de recargas.",
    searchPlaceholder: "Buscar nome, ID, e-mail ou placa",
    icon: Users,
    filters: [
      { label: "Todos", value: "todos" },
      { label: "Ativos", value: "ativo" },
      { label: "Inativos", value: "inativo" },
    ],
  },
};

export const operationColumns: Record<ApiResource, OperationColumn[]> = {
  carregadores: [
    {
      label: "Carregador",
      render: (row) => {
        const charger = row as Charger;
        return (
          <div className="entity-cell">
            <strong>{charger.nome}</strong>
            <small>{charger.carregadorId}</small>
          </div>
        );
      },
    },
    {
      label: "Status",
      render: (row) => <StatusBadge status={(row as Charger).status} />,
    },
    {
      label: "Local",
      render: (row) => {
        const charger = row as Charger;
        return `${charger.estacaoNome} · ${charger.localizacao}`;
      },
    },
    {
      label: "Potência",
      render: (row) => {
        const charger = row as Charger;
        return `${formatKw(charger.potenciaAtualKw)} / ${formatKw(
          charger.potenciaMaximaKw
        )}`;
      },
    },
    {
      label: "Energia hoje",
      render: (row) => formatKwh((row as Charger).energiaHojeKwh),
    },
    {
      label: "Última comunicação",
      render: (row) => formatDateTime((row as Charger).ultimaComunicacao),
    },
  ],
  sessoes: [
    {
      label: "Sessão / cliente",
      render: (row) => {
        const session = row as ChargingSession;
        return (
          <div className="entity-cell">
            <strong>{session.sessaoId}</strong>
            <small>{session.usuarioNome}</small>
          </div>
        );
      },
    },
    {
      label: "Status",
      render: (row) => <StatusBadge status={(row as ChargingSession).status} />,
    },
    {
      label: "Carregador",
      render: (row) => (row as ChargingSession).carregadorNome,
    },
    {
      label: "Início",
      render: (row) => formatDateTime((row as ChargingSession).dataInicio),
    },
    {
      label: "Duração",
      render: (row) => <span style={{ whiteSpace: 'nowrap' }}>{formatMinutes((row as ChargingSession).duracaoMinutos)}</span>,
    },
    {
      label: "Energia",
      className: "operation-numeric",
      render: (row) => formatKwh((row as ChargingSession).energiaKwh),
    },
    {
      label: "Valor",
      className: "operation-numeric",
      render: (row) => formatCurrency((row as ChargingSession).valorTotal),
    },
  ],
  pagamentos: [
    {
      label: "Pagamento",
      render: (row) => {
        const payment = row as Payment;
        return (
          <div className="entity-cell">
            <strong>{payment.pagamentoId}</strong>
            <small>{payment.sessaoId}</small>
          </div>
        );
      },
    },
    {
      label: "Status",
      render: (row) => <StatusBadge status={(row as Payment).status} />,
    },
    {
      label: "Cliente",
      render: (row) => (row as Payment).usuarioNome,
    },
    {
      label: "Método",
      render: (row) => ({ PIX: 'PIX', cartao: 'Cartão', carteira: 'Carteira', caixa: 'Caixa', simulado: 'Simulado' }[(row as Payment).metodo]),
    },
    {
      label: "Valor",
      className: "operation-numeric",
      render: (row) => formatCurrency((row as Payment).valorTotal),
    },
    {
      label: "Confirmação",
      render: (row) => (row as Payment).dataPagamento ? formatDateTime((row as Payment).dataPagamento) : 'Não confirmado',
    },
  ],
  alertas: [
    {
      label: "Alerta",
      render: (row) => {
        const alert = row as Alert;
        return (
          <div className="entity-cell">
            <strong>{alert.titulo}</strong>
            <small>{alert.descricao}</small>
          </div>
        );
      },
    },
    {
      label: "Status",
      render: (row) => <StatusBadge status={(row as Alert).status} />,
    },
    {
      label: "Severidade",
      render: (row) => <StatusBadge status={(row as Alert).severidade} />,
    },
    {
      label: "Origem",
      render: (row) => (row as Alert).origem,
    },
    {
      label: "Carregador",
      render: (row) => (row as Alert).carregadorNome ?? "Geral",
    },
    {
      label: "Criado em",
      render: (row) => formatDateTime((row as Alert).dataCriacao),
    },
  ],
  clientes: [
    {
      label: "Cliente",
      render: (row) => {
        const client = row as Client;
        return (
          <div className="entity-cell">
            <strong>{client.nome}</strong>
            <small>{client.usuarioId}</small>
          </div>
        );
      },
    },
    {
      label: "Status",
      render: (row) => <StatusBadge status={(row as Client).status} />,
    },
    {
      label: "Contato",
      render: (row) => (row as Client).email,
    },
    {
      label: "Veículo",
      render: (row) => {
        const client = row as Client;
        const values = [client.veiculo, client.placa].filter(value => value && !normalizeText(value).startsWith('nao informad'));
        return values.length ? values.join(' · ') : 'Não informado';
      },
    },
    {
      label: "Sessões",
      className: "operation-numeric",
      render: (row) => (row as Client).totalSessoes,
    },
    {
      label: "Total gasto",
      className: "operation-numeric",
      render: (row) => formatCurrency((row as Client).totalGasto),
    },
  ],
};

export function getRowStatus(resource: ApiResource, row: ResourceRow) {
  if (resource === "carregadores") return (row as Charger).status;
  if (resource === "sessoes") return (row as ChargingSession).status;
  if (resource === "pagamentos") return (row as Payment).status;
  if (resource === "alertas") {
    const alert = row as Alert;
    return `${alert.status} ${alert.severidade}`;
  }
  return (row as Client).status;
}

export function getRowKey(resource: ApiResource, row: ResourceRow) {
  if (resource === "carregadores") return (row as Charger).carregadorId;
  if (resource === "sessoes") return (row as ChargingSession).sessaoId;
  if (resource === "pagamentos") return (row as Payment).pagamentoId;
  if (resource === "alertas") return (row as Alert).alertaId;
  return (row as Client).usuarioId;
}

export function getRowSearchText(row: ResourceRow) {
  return normalizeText(Object.values(row).join(" "));
}

export function getActionLabel(resource: ApiResource, row: ResourceRow) {
  if(resource==='sessoes' && (row as ChargingSession).status==='aguardando_pagamento' && (row as ChargingSession).valorTotal>0 && (row as ChargingSession).valorTotal<.5)return 'Acerto no caixa';
  if (resource === "carregadores") return "Solicitar leitura";
  if (resource === "sessoes" && (row as ChargingSession).status === "ativa") {
    return "Finalizar";
  }
  if (resource === "pagamentos" && (row as Payment).status === "pendente") {
    return "Aprovar";
  }
  if (resource === "alertas" && (row as Alert).status !== "resolvido") {
    return "Resolver";
  }
  return null;
}
