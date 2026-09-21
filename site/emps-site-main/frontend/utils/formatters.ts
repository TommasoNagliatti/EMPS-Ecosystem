import {
  AlertSeverity,
  AlertStatus,
  ChargerStatus,
  PaymentStatus,
  SessionStatus,
} from "@/domain/emps";

export function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function formatKwh(value: number) {
  return `${value.toLocaleString("pt-BR", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  })} kWh`;
}

export function formatKw(value: number) {
  return `${value.toLocaleString("pt-BR", {
    maximumFractionDigits: 1,
  })} kW`;
}

export function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}min` : `${hours}h`;
}

export function formatDateTime(value: string | null) {
  if (!value) return "Em andamento";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

export function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

export function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function chargerStatusLabel(status: ChargerStatus) {
  const labels: Record<ChargerStatus, string> = {
    disponivel: "Disponivel",
    em_uso: "Em uso",
    offline: "Offline",
    manutencao: "Manutencao",
    erro: "Erro",
  };
  return labels[status];
}

export function sessionStatusLabel(status: SessionStatus) {
  const labels: Record<SessionStatus, string> = {
    ativa: "Ativa",
    finalizada: "Finalizada",
    cancelada: "Cancelada",
    aguardando_pagamento: "Aguardando pagamento",
  };
  return labels[status];
}

export function paymentStatusLabel(status: PaymentStatus) {
  const labels: Record<PaymentStatus, string> = {
    pendente: "Pendente",
    aprovado: "Aprovado",
    recusado: "Recusado",
    estornado: "Estornado",
  };
  return labels[status];
}

export function alertStatusLabel(status: AlertStatus) {
  const labels: Record<AlertStatus, string> = {
    aberto: "Aberto",
    verificando: "Verificando",
    resolvido: "Resolvido",
  };
  return labels[status];
}

export function severityLabel(severity: AlertSeverity) {
  const labels: Record<AlertSeverity, string> = {
    baixa: "Baixa",
    media: "Media",
    alta: "Alta",
    critica: "Critica",
  };
  return labels[severity];
}

export function statusTone(
  status: ChargerStatus | SessionStatus | PaymentStatus | AlertStatus | AlertSeverity
) {
  if (
    ["disponivel", "aprovado", "resolvido", "baixa", "finalizada"].includes(status)
  ) {
    return "success";
  }
  if (
    ["em_uso", "ativa", "verificando", "media", "aguardando_pagamento"].includes(
      status
    )
  ) {
    return "info";
  }
  if (["manutencao", "pendente", "alta"].includes(status)) return "warning";
  if (
    ["offline", "erro", "recusado", "critica", "cancelada"].includes(status)
  ) {
    return "danger";
  }
  return "neutral";
}
