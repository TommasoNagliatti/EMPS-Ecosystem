import type { ChargerStatus } from "@/domain/emps";

export type ChargerVisualTone = "free" | "busy" | "warning" | "danger";

export type ChargerVisualAsset = {
  className: string;
  height: number;
  src: string;
  width: number;
};

export const chargerVisualStates: Record<
  ChargerStatus,
  {
    asset: ChargerVisualAsset;
    hint: string;
    label: string;
    tone: ChargerVisualTone;
  }
> = {
  disponivel: {
    asset: {
      className: "charging-pile-asset",
      height: 828,
      src: "/charging-pile-available.png",
      width: 256,
    },
    hint: "Pronto para carregar",
    label: "Liberado",
    tone: "free",
  },
  em_uso: {
    asset: {
      className: "charging-vehicle-asset",
      height: 808,
      src: "/charging-car-connected-v2.png",
      width: 1439,
    },
    hint: "Carro conectado",
    label: "Ocupado",
    tone: "busy",
  },
  manutencao: {
    asset: {
      className: "charging-pile-warning-asset",
      height: 1536,
      src: "/charging-pile-warning.png",
      width: 1024,
    },
    hint: "Equipe acionada",
    label: "Atencao",
    tone: "warning",
  },
  offline: {
    asset: {
      className: "charging-pile-danger-asset",
      height: 1536,
      src: "/charging-pile-danger.png",
      width: 1024,
    },
    hint: "Sem comunicacao",
    label: "Quebrado",
    tone: "danger",
  },
  erro: {
    asset: {
      className: "charging-pile-danger-asset",
      height: 1536,
      src: "/charging-pile-danger.png",
      width: 1024,
    },
    hint: "Falha operacional",
    label: "Quebrado",
    tone: "danger",
  },
};
