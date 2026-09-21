"use client";

import { Menu, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import {
  empsNavigationItems,
  semsSidebarItems,
  semsToolbarItems,
} from "@/components/shell/shell-navigation";
import { api } from "@/services/emps-api";
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

function EmpsLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className={compact ? "emps-logo emps-logo--compact" : "emps-logo"}>
      <span className="emps-logo__mask" aria-hidden="true" />
    </span>
  );
}

function SemsLogo() {
  return (
    <span className="sems-logo">
      <Image
        alt=""
        aria-hidden="true"
        className="sems-logo__mark"
        height={29}
        priority
        src="/goodwe_logo_w.d807055f.png"
        width={30}
      />
      <small>SEMS+</small>
    </span>
  );
}

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/" || pathname === "/dashboard";
  return pathname.startsWith(href);
}

export function AppShell({
  eyebrow,
  title,
  description,
  showEmpsHeaderLogo = false,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  showEmpsHeaderLogo?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [empsMenuOpen, setEmpsMenuOpen] = useState(false);
  const { status: realtimeStatus } = useRealtime();
  const breadcrumb = eyebrow.startsWith("SEMS+") ? eyebrow : `SEMS+ / ${eyebrow}`;

  useEffect(() => {
    setMenuOpen(false);
    setEmpsMenuOpen(false);
  }, [pathname]);

  return (
    <div className="app-shell">
      {menuOpen && (
        <button
          className="mobile-scrim"
          onClick={() => setMenuOpen(false)}
          aria-label="Fechar navegacao"
        />
      )}

      <aside className={`sidebar ${menuOpen ? "sidebar--open" : ""}`}>
        <div className="brand-row">
          <Link href="/dashboard" className="rail-brand" aria-label="SEMS+">
            <SemsLogo />
          </Link>
          <button
            className="icon-button sidebar-close"
            onClick={() => setMenuOpen(false)}
            aria-label="Fechar menu"
            title="Fechar menu"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="nav-list" aria-label="Navegacao principal">
          <div className="nav-section">
            <span className="nav-section-label">SEMS+</span>
            {semsSidebarItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  type="button"
                  className="nav-item sems-shell-item"
                  onClick={() => setEmpsMenuOpen(false)}
                  title={item.label}
                  aria-label={item.label}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          <div className="nav-section nav-section--emps">
            <span className="nav-section-label">EMPS</span>
            <button
              type="button"
              className={`nav-item emps-rail-trigger ${empsMenuOpen ? "nav-item--active" : ""}`}
              onClick={() => setEmpsMenuOpen((open) => !open)}
              title="Modulo EMPS"
              aria-label="Abrir modulo EMPS"
              aria-expanded={empsMenuOpen}
              aria-haspopup="menu"
            >
              <EmpsLogo compact />
              <span>EMPS</span>
            </button>
          </div>
        </nav>

        {empsMenuOpen && (
          <div className="emps-popover" role="dialog" aria-label="Modulo EMPS">
            <div className="emps-popover__list">
              {empsNavigationItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    className={`emps-popover__item ${isActive(pathname, item.href) ? "active" : ""}`}
                    href={item.href}
                    key={item.href}
                    onClick={() => {
                      setMenuOpen(false);
                      setEmpsMenuOpen(false);
                    }}
                  >
                    <span className="emps-popover__icon">
                      <Icon size={15} aria-hidden="true" />
                    </span>
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </aside>

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
                <span>{breadcrumb}</span>
                <h1>{title}</h1>
                {description && <p>{description}</p>}
              </div>
            )}
          </div>

          <div className="topbar-actions" aria-label="Acoes SEMS+">
            <span
              className={`topbar-sync topbar-sync--${realtimeStatus}`}
              role="status"
              aria-live="polite"
              title="Estado da sincronizacao entre painel, aplicativo e API"
            >
              <i aria-hidden="true" />
              {realtimeLabels[realtimeStatus]}
            </span>
            {semsToolbarItems.map((item) => {
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
            <button
              className="sems-profile-button"
              type="button"
              aria-label="Sair"
              title="Sair"
              onClick={() => api.logout()}
            >
              <span>EM</span>
            </button>
          </div>
        </header>

        <div className="page-content">{children}</div>
      </main>
    </div>
  );
}
