import {
  AlertTriangle,
  Banknote,
  CircleDollarSign,
  Gauge,
  PlugZap,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { DashboardData } from "@/domain/emps";
import {
  clampPercent,
  formatCurrency,
  formatKwh,
  formatPercent,
} from "@/utils/formatters";

export type DashboardMetric = {
  bars: number[];
  detail: string;
  icon: LucideIcon;
  label: string;
  progress: number;
  sideLabel: string;
  sideValue: string;
  tone: string;
  value: string;
};

function normalizeBars(values: number[]) {
  const visibleValues = values.slice(-8);
  const maxValue = Math.max(...visibleValues, 1);

  return visibleValues.map((value) =>
    Math.max(12, Math.round((value / maxValue) * 100))
  );
}

function maxValue(values: number[]) {
  return Math.max(...values, 0);
}

export function getDashboardMetrics(data: DashboardData): DashboardMetric[] {
  const resumo = data.resumo;
  const totalChargers = Math.max(data.carregadores.length, 1);
  const approvedPayments = data.pagamentos
    .filter((payment) => payment.status === "aprovado")
    .map((payment) => payment.valorTotal);
  const revenueByHour = data.receitaPorHora.map((point) => point.receita);
  const energyByHour = data.energiaPorHora.map((point) => point.energiaKwh);
  const sessionsByHour = data.receitaPorHora.map((point) => point.sessoes);
  const monthReference = Math.max(resumo.receitaMes, resumo.receitaHoje * 30, 1);
  const dailyReference = Math.max(monthReference / 30, 1);

  return [
    {
      bars: normalizeBars(revenueByHour),
      detail: "Pagamentos aprovados",
      icon: Banknote,
      label: "Receita hoje",
      progress: clampPercent((resumo.receitaHoje / dailyReference) * 100),
      sideLabel: "pico/hora",
      sideValue: formatCurrency(maxValue(revenueByHour)),
      tone: "coral",
      value: formatCurrency(resumo.receitaHoje),
    },
    {
      bars: normalizeBars([
        resumo.receitaMes * 0.18,
        resumo.receitaMes * 0.31,
        resumo.receitaMes * 0.46,
        resumo.receitaMes * 0.58,
        resumo.receitaMes * 0.72,
        resumo.receitaMes,
      ]),
      detail: "Base operacional",
      icon: CircleDollarSign,
      label: "Receita no mes",
      progress: clampPercent((resumo.receitaMes / monthReference) * 100),
      sideLabel: "ritmo/dia",
      sideValue: formatCurrency(resumo.receitaMes / 30),
      tone: "violet",
      value: formatCurrency(resumo.receitaMes),
    },
    {
      bars: normalizeBars(energyByHour),
      detail: "Numero puro da API",
      icon: Zap,
      label: "Energia hoje",
      progress: clampPercent(
        (resumo.energiaHojeKwh /
          Math.max(
            data.carregadores.reduce(
              (sum, charger) => sum + charger.potenciaMaximaKw,
              0
            ) * 6,
            1
          )) *
          100
      ),
      sideLabel: "pico/hora",
      sideValue: formatKwh(maxValue(energyByHour)),
      tone: "cyan",
      value: formatKwh(resumo.energiaHojeKwh),
    },
    {
      bars: normalizeBars(sessionsByHour),
      detail: `${resumo.sessoesAtivas} em andamento`,
      icon: Users,
      label: "Sessoes hoje",
      progress: clampPercent(
        (resumo.sessoesHoje / Math.max(resumo.sessoesHoje + 8, 1)) * 100
      ),
      sideLabel: "ativas agora",
      sideValue: String(resumo.sessoesAtivas),
      tone: "blue",
      value: String(resumo.sessoesHoje),
    },
    {
      bars: normalizeBars(
        data.carregadores.map((charger) =>
          charger.status === "disponivel" ? 100 : 24
        )
      ),
      detail: "Prontos para iniciar",
      icon: PlugZap,
      label: "Disponiveis",
      progress: clampPercent(
        (resumo.carregadoresDisponiveis / totalChargers) * 100
      ),
      sideLabel: "livres",
      sideValue: `${resumo.carregadoresDisponiveis}/${totalChargers}`,
      tone: "green",
      value: String(resumo.carregadoresDisponiveis),
    },
    {
      bars: normalizeBars(
        data.carregadores.map((charger) =>
          ["offline", "erro"].includes(charger.status) ? 100 : 14
        )
      ),
      detail: "Exige verificacao",
      icon: AlertTriangle,
      label: "Offline",
      progress: clampPercent((resumo.carregadoresOffline / totalChargers) * 100),
      sideLabel: "criticos",
      sideValue: String(resumo.alertasCriticos),
      tone: "red",
      value: String(resumo.carregadoresOffline),
    },
    {
      bars: normalizeBars(
        data.carregadores.map((charger) => charger.ocupacaoHojePercent)
      ),
      detail: "Uso da rede",
      icon: Gauge,
      label: "Ocupacao",
      progress: clampPercent(resumo.taxaOcupacao),
      sideLabel: "media",
      sideValue: formatPercent(resumo.taxaOcupacao),
      tone: "orange",
      value: formatPercent(resumo.taxaOcupacao),
    },
    {
      bars: normalizeBars(approvedPayments),
      detail: "Transacao aprovada",
      icon: TrendingUp,
      label: "Ticket medio",
      progress: clampPercent(
        (resumo.ticketMedio / Math.max(maxValue(approvedPayments), 1)) * 100
      ),
      sideLabel: "maior ticket",
      sideValue: formatCurrency(maxValue(approvedPayments)),
      tone: "yellow",
      value: formatCurrency(resumo.ticketMedio),
    },
  ];
}
