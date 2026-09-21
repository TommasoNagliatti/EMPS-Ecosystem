import {
  AlertTriangle,
  BatteryCharging,
  Building2,
  ChartPie,
  CreditCard,
  GaugeCircle,
  Globe2,
  HeartPulse,
  HousePlug,
  LayoutDashboard,
  MessageSquare,
  PlugZap,
  Search,
  Settings,
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

export const semsSidebarItems: ShellNavigationItem[] = [
  { label: "Painel SEMS+", icon: HousePlug },
  { label: "Dispositivos", icon: Waypoints },
  { label: "Alarmes", icon: Siren },
  { label: "Usinas", icon: Building2 },
  { label: "Analises", icon: ChartPie },
  { label: "Centro de servico", icon: HeartPulse },
];

export const empsNavigationItems: ModuleNavigationItem[] = [
  { label: "Painel", href: "/dashboard", icon: LayoutDashboard },
  { label: "Configuracoes EMPS", href: "/settings", icon: Settings },
  { label: "Carregadores", href: "/chargers", icon: PlugZap },
  { label: "Sessoes", href: "/sessions", icon: BatteryCharging },
  { label: "Pagamentos", href: "/payments", icon: CreditCard },
  { label: "Clientes", href: "/clients", icon: Users },
  { label: "Alertas", href: "/alerts", icon: AlertTriangle },
];

export const empsTopTabs = [
  { label: "Painel", href: "/dashboard" },
  { label: "Alarmes", href: "/alerts" },
];

export const semsToolbarItems: ShellNavigationItem[] = [
  { label: "Buscar", icon: Search },
  { label: "Dispositivos", icon: Siren },
  { label: "Mensagens", icon: MessageSquare },
  { label: "Monitoramento", icon: GaugeCircle },
  { label: "Idioma", icon: Globe2 },
];
