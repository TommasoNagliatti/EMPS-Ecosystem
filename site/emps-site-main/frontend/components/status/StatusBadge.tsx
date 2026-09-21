import {
  AlertSeverity,
  AlertStatus,
  ChargerStatus,
  PaymentStatus,
  SessionStatus,
} from "@/domain/emps";
import {
  alertStatusLabel,
  chargerStatusLabel,
  paymentStatusLabel,
  sessionStatusLabel,
  severityLabel,
  statusTone,
} from "@/utils/formatters";

type StatusValue =
  | ChargerStatus
  | SessionStatus
  | PaymentStatus
  | AlertStatus
  | AlertSeverity
  | "ativo"
  | "inativo"
  | "pronto"
  | "pendente"
  | "bloqueado";

function labelFor(status: StatusValue) {
  if (["disponivel", "em_uso", "offline", "manutencao", "erro"].includes(status)) {
    return chargerStatusLabel(status as ChargerStatus);
  }
  if (
    ["ativa", "finalizada", "cancelada", "aguardando_pagamento"].includes(status)
  ) {
    return sessionStatusLabel(status as SessionStatus);
  }
  if (["aprovado", "recusado", "estornado"].includes(status)) {
    return paymentStatusLabel(status as PaymentStatus);
  }
  if (["aberto", "verificando", "resolvido"].includes(status)) {
    return alertStatusLabel(status as AlertStatus);
  }
  if (["baixa", "media", "alta", "critica"].includes(status)) {
    return severityLabel(status as AlertSeverity);
  }
  const fallback: Record<string, string> = {
    ativo: "Ativo",
    inativo: "Inativo",
    pronto: "Pronto",
    pendente: "Pendente",
    bloqueado: "Bloqueado",
  };
  return fallback[status] ?? status;
}

function toneFor(status: StatusValue) {
  if (status === "ativo" || status === "pronto") return "success";
  if (status === "inativo" || status === "bloqueado") return "danger";
  return statusTone(status as Parameters<typeof statusTone>[0]);
}

export function StatusBadge({
  status,
  label,
}: {
  status: StatusValue;
  label?: string;
}) {
  return (
    <span className={`status-badge status-badge--${toneFor(status)}`}>
      <span aria-hidden="true" />
      {label ?? labelFor(status)}
    </span>
  );
}

