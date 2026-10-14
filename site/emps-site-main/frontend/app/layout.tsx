import type { Metadata } from "next";
import "./globals.css";
import "@/styles/tokens.css";
import "@/styles/base.css";
import "@/styles/shell.css";
import "@/styles/dashboard.css";
import "@/styles/charger-board.css";
import "@/styles/energy-flow.css";
import "@/styles/shared-panels.css";
import "@/styles/operational-pages.css";
import "@/styles/provisioning.css";
import "@/styles/settings.css";
import "@/styles/login.css";
import "@/styles/animations.css";
import "@/styles/responsive.css";
import "@/styles/theme.css";
import { RealtimeProvider } from "@/components/realtime/RealtimeProvider";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { themeBootstrap } from "@/components/theme/theme-store";

export const metadata: Metadata = {
  title: {
    default: "EMPS | Painel Operacional",
    template: "%s | EMPS",
  },
  description:
    "Front administrativo do EMPS para operacao, pagamentos, alertas e carregadores.",
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" data-theme="dark" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
        <ThemeProvider><RealtimeProvider>{children}</RealtimeProvider></ThemeProvider>
      </body>
    </html>
  );
}
