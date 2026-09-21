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
    description: "Rede de equipamentos com status canonico e telemetria basica.",
    icon: PlugZap,
    filters: [
      { label: "Todos", value: "todos" },
      { label: "Disponiveis", value: "disponivel" },
      { label: "Em uso", value: "em_uso" },
      { label: "Offline", value: "offline" },
      { label: "Manutencao", value: "manutencao" },
    ],
  },
  sessoes: {
    title: "Sessoes",
    eyebrow: "EMPS / Operacao",
    description: "Ciclo de recarga com duracao, energia e valor em dados puros.",
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
    description: "Transacoes vinculadas a sessoes, sem formatacao monetaria na origem.",
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
    description: "Eventos operacionais normalizados pela API antes de chegar ao site.",
    icon: AlertTriangle,
    filters: [
      { label: "Todos", value: "todos" },
      { label: "Abertos", value: "aberto" },
      { label: "Verificando", value: "verificando" },
      { label: "Resolvidos", value: "resolvido" },
      { label: "Criticos", value: "critica" },
    ],
  },
  clientes: {
    title: "Clientes",
    eyebrow: "EMPS / Relacionamento",
    description: "Usuarios finais identificados por ID, com nome apenas para exibicao.",
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
      label: "Potencia",
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
      label: "Ultima comunicacao",
      render: (row) => formatDateTime((row as Charger).ultimaComunicacao),
    },
  ],
  sessoes: [
    {
      label: "Sessao",
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
      label: "Inicio",
      render: (row) => formatDateTime((row as ChargingSession).dataInicio),
    },
    {
      label: "Duracao",
      render: (row) => formatMinutes((row as ChargingSession).duracaoMinutos),
    },
    {
      label: "Energia",
      render: (row) => formatKwh((row as ChargingSession).energiaKwh),
    },
    {
      label: "Valor",
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
      label: "Metodo",
      render: (row) => (row as Payment).metodo,
    },
    {
      label: "Valor",
      render: (row) => formatCurrency((row as Payment).valorTotal),
    },
    {
      label: "Confirmacao",
      render: (row) => formatDateTime((row as Payment).dataPagamento),
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
      label: "Veiculo",
      render: (row) => {
        const client = row as Client;
        return `${client.veiculo} · ${client.placa}`;
      },
    },
    {
      label: "Sessoes",
      render: (row) => (row as Client).totalSessoes,
    },
    {
      label: "Total gasto",
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
