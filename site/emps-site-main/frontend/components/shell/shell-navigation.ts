import {
  AlertTriangle,
  BatteryCharging,
  Building2,
  ChartPie,
  CreditCard,
  FileChartColumn,
  GaugeCircle,
  Globe2,
  HeartPulse,
  HousePlug,
  MessageSquare,
  PlugZap,
  Search,
  Siren,
  Users,
  Waypoints,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type ShellNavigationItem = {
  label: string;
  icon: LucideIcon;
};

export type ModuleNavigationItem = ShellNavigationItem & {
  href: string;
};

export type SemsNavigationItem = ShellNavigationItem & {
  href?: string;
  children?: { label: string; href: string }[];
};

export const semsSidebarItems: SemsNavigationItem[] = [
  { label: "Lista de usinas", icon: HousePlug, href: "https://semsplus.goodwe.com/#/station_monitor" },
  { label: "Dispositivos", icon: Waypoints, href: "https://semsplus.goodwe.com/#/device_monitor" },
  { label: "Alarmes", icon: Siren, href: "https://semsplus.goodwe.com/#/alarm_center" },
  { label: "Relatórios", icon: FileChartColumn, href: "https://semsplus.goodwe.com/#/report_center" },
  { label: "Análises", icon: ChartPie, children: [
    { label: "Diagnóstico IV", href: "https://semsplus.goodwe.com/#/iv_diagnosis" },
    { label: "Comparação de dados", href: "https://semsplus.goodwe.com/#/data_comparison" },
    { label: "Consistência da bateria", href: "https://semsplus.goodwe.com/#/battery_consistency" },
  ] },
  { label: "Centro de serviço", icon: HeartPulse, href: "https://semsplus.goodwe.com/#/sevices" },
];

export const empsNavigationItems: ModuleNavigationItem[] = [
  {label:"Minhas instalações",href:"/stations",icon:Building2},
  { label: "Carregadores", href: "/chargers", icon: PlugZap },
  { label: "Sessoes", href: "/sessions", icon: BatteryCharging },
  { label: "Pagamentos", href: "/payments", icon: CreditCard },
  { label: "Clientes", href: "/clients", icon: Users },
  { label: "Alertas", href: "/alerts", icon: AlertTriangle },
];

export const empsTopTabs = [
  { label: "Minhas instalações", href: "/stations" },
  { label: "Alarmes", href: "/alerts" },
];

export const semsToolbarItems: ShellNavigationItem[] = [
  { label: "Buscar", icon: Search },
  { label: "Dispositivos", icon: Siren },
  { label: "Mensagens", icon: MessageSquare },
  { label: "Monitoramento", icon: GaugeCircle },
  { label: "Idioma", icon: Globe2 },
];
