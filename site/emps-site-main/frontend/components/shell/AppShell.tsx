"use client";

import { Menu } from "lucide-react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { semsToolbarItems } from "@/components/shell/shell-navigation";
import { SidebarNavigation } from "@/components/shell/SidebarNavigation";
import { ProfileMenu } from "@/components/account/ProfileMenu";
import {
  useRealtime,
  type RealtimeStatus,
} from "@/components/realtime/RealtimeProvider";

const realtimeLabels: Record<RealtimeStatus, string> = {
  connected: "Ao vivo",
  connecting: "Conectando",
  disconnected: "Reconectando",
  disabled: "Dados demonstrativos",
};

export function AppShell({
  eyebrow,
  title,
  description,
  showEmpsHeaderLogo = false,
  className = '',
  hideEyebrow = false,
  showRealtimeStatus = true,
  languageControl,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  showEmpsHeaderLogo?: boolean;
  className?: string;
  hideEyebrow?: boolean;
  showRealtimeStatus?: boolean;
  languageControl?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const { status: realtimeStatus } = useRealtime();
  const breadcrumb = eyebrow.startsWith("SEMS+") ? eyebrow : `SEMS+ / ${eyebrow}`;

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    try { setSidebarExpanded(localStorage.getItem("emps-sidebar-expanded") === "true"); } catch {}
  }, []);

  function toggleSidebar() {
    const expanded = !sidebarExpanded;
    setSidebarExpanded(expanded);
    try { localStorage.setItem("emps-sidebar-expanded", String(expanded)); } catch {}
  }

  return (
    <div className={`app-shell ${sidebarExpanded ? "app-shell--expanded" : ""} ${className}`}>
      {menuOpen && (
        <button
          className="mobile-scrim"
          onClick={() => setMenuOpen(false)}
          aria-label="Fechar navegacao"
        />
      )}

      <SidebarNavigation key={pathname} pathname={pathname} expanded={sidebarExpanded} mobileOpen={menuOpen} onToggle={toggleSidebar} onClose={() => setMenuOpen(false)} />

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-title">
            <button
              className="icon-button menu-button"
              onClick={() => setMenuOpen(true)}
              aria-label="Abrir menu"
              title="Abrir menu"
            >
              <Menu size={20} />
            </button>
            {showEmpsHeaderLogo ? (
              <span
                className="topbar-emps-brand topbar-emps-brand--title"
                aria-label={title}
              >
                <Image
                  alt="EMPS"
                  className="topbar-emps-brand__image"
                  height={428}
                  priority
                  src="/emps-logo-red.png"
                  width={1261}
                />
              </span>
            ) : (
              <div>
                {!hideEyebrow && <span>{breadcrumb}</span>}
                <h1>{title}</h1>
                {description && <p>{description}</p>}
              </div>
            )}
          </div>

          <div className="topbar-actions" aria-label="Acoes SEMS+">
            {showRealtimeStatus && <span
              className={`topbar-sync topbar-sync--${realtimeStatus}`}
              role="status"
              aria-live="polite"
              title="Estado da sincronizacao entre painel, aplicativo e API"
            >
              <i aria-hidden="true" />
              {realtimeLabels[realtimeStatus]}
            </span>}
            {semsToolbarItems.map((item) => {
              if (item.label === 'Idioma' && languageControl) return <span key={item.label}>{languageControl}</span>;
              const Icon = item.icon;
              return (
                <button
                  className="sems-top-action"
                  key={item.label}
                  type="button"
                  aria-label={item.label}
                  title={item.label}
                >
                  <Icon size={19} aria-hidden="true" />
                </button>
              );
            })}
            <ProfileMenu key={pathname} />
          </div>
        </header>

        <div className="page-content">{children}</div>
      </main>
    </div>
  );
}
