import {
  Clock3,
  DatabaseZap,
  KeyRound,
  PlugZap,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { StatusBadge } from "@/components/status/StatusBadge";

const demoMode = process.env.NEXT_PUBLIC_EMPS_DEMO_MODE === "true";

const settings = [
  {
    icon: DatabaseZap,
    label: "Fonte de dados",
    value: demoMode ? "Demonstracao local" : "API EMPS",
    status: demoMode ? ("pendente" as const) : ("pronto" as const),
    detail: demoMode
      ? "Mocks habilitados explicitamente pela configuracao do ambiente."
      : `Backend autenticado em ${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}.`,
  },
  {
    icon: KeyRound,
    label: "Autenticacao",
    value: demoMode ? "Sessao demonstrativa" : "JWT Bearer",
    status: demoMode ? ("pendente" as const) : ("pronto" as const),
    detail: demoMode
      ? "Token real desativado enquanto o modo de demonstracao estiver ativo."
      : "Login real pela API, token na sessao do navegador e logout em respostas 401.",
  },
  {
    icon: ShieldCheck,
    label: "SEMS+",
    value: "Bloqueado no front",
    status: "pronto" as const,
    detail: "Credenciais e assinatura apenas no backend.",
  },
  {
    icon: PlugZap,
    label: "Status canonicos",
    value: "Ativos",
    status: "pronto" as const,
    detail: "Carregadores, sessoes, pagamentos e alertas padronizados.",
  },
  {
    icon: WalletCards,
    label: "Moeda e energia",
    value: "Formatacao visual",
    status: "pronto" as const,
    detail: "A origem usa numeros puros; a tela formata para pt-BR.",
  },
  {
    icon: Clock3,
    label: "Tempo real",
    value: demoMode ? "Telemetria simulada" : "Live status da API",
    status: demoMode ? ("pendente" as const) : ("pronto" as const),
    detail: demoMode
      ? "Valores locais representam o comportamento esperado da telemetria."
      : "Station e liveStatus sao consumidos quando disponibilizados pelo backend.",
  },
];

export default function SettingsPage() {
  return (
    <AppShell
      eyebrow="SEMS+ / EMPS"
      title="Configuracoes do Eletroposto"
      description="Modulo EMPS dentro do SEMS+ para governanca, integracao e operacao do eletroposto."
      showEmpsHeaderLogo
    >
      <section className="settings-grid">
        {settings.map((item) => {
          const Icon = item.icon;
          return (
            <article className="setting-card" key={item.label}>
              <div className="setting-card__top">
                <span className="metric-icon metric-icon--cyan">
                  <Icon size={19} aria-hidden="true" />
                </span>
                <StatusBadge status={item.status} />
              </div>
              <small>{item.label}</small>
              <strong>{item.value}</strong>
              <p>{item.detail}</p>
            </article>
          );
        })}
      </section>
    </AppShell>
  );
}

