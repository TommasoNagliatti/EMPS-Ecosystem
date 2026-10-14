"use client";

import { ChevronDown, ChevronLeft, ChevronRight, Layers2, X } from "lucide-react";
import Image from "next/image";
import { NavigationLink as Link } from './NavigationLink';
import { useId, useState } from "react";
import { empsNavigationItems, semsSidebarItems } from "./shell-navigation";
import { Popover } from "@/components/ui/Popover";
import { stationWizardFont } from "@/components/stations/station-wizard-font";

function EmpsLogo() {
  return <span className="emps-logo emps-logo--compact" aria-hidden="true"><span className="emps-logo__mask" /></span>;
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNavigation({ pathname, expanded, mobileOpen, onToggle, onClose }: {
  pathname: string;
  expanded: boolean;
  mobileOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const analysisId = useId();
  const empsId = useId();
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [empsOpen, setEmpsOpen] = useState(true);
  const activeModule = empsNavigationItems.some(item => isActive(pathname, item.href)) || pathname.startsWith("/account");

  function empsLinks(close?: () => void) {
    return empsNavigationItems.map(item => <Link key={item.href} href={item.href}
      className={`sidebar-submenu-item ${isActive(pathname, item.href) ? "sidebar-submenu-item--active" : ""}`}
      aria-current={isActive(pathname, item.href) ? "page" : undefined}
      onClick={() => { close?.(); onClose(); }}>
      {item.label}
    </Link>);
  }

  return <aside className={`sidebar ${stationWizardFont.className} ${mobileOpen ? "sidebar--open" : ""}`}>
    <div className="brand-row">
      <a href="https://semsplus.goodwe.com/#/station_monitor" target="_blank" rel="noreferrer" className="rail-brand" aria-label="SEMS+">
        <span className="sems-logo">
          <Image alt="" aria-hidden="true" className="sems-logo__mark" height={29} priority src="/goodwe_logo_w.d807055f.png" width={30} />
          <small>SEMS+</small>
        </span>
        <span className="sems-wordmark">
          <Image alt="GOODWE" className="sems-wordmark__image" height={18} src="/goodwe_logo.eb050bb6.png" width={120} />
          <small>Smart Energy Management System</small>
        </span>
      </a>
      <button className="icon-button sidebar-close" onClick={onClose} aria-label="Fechar menu" title="Fechar menu"><X size={18} /></button>
    </div>

    <nav className="nav-list" aria-label="Navegacao principal">
      <div className="nav-section">
        {semsSidebarItems.map(item => {
          const Icon = item.icon;
          if (item.children) {
            const links = item.children.map(child => <a key={child.href} href={child.href} target="_blank" rel="noreferrer" className="sidebar-submenu-item sems-shell-item">{child.label}</a>);
            return <div className="sidebar-group" key={item.label}>
              {expanded ? <>
                <button type="button" className="nav-item sems-shell-item" aria-label={item.label} aria-expanded={analysisOpen} aria-controls={analysisId} onClick={() => setAnalysisOpen(value => !value)}>
                  <Icon size={20} aria-hidden="true" /><span>{item.label}</span><ChevronDown className={`sidebar-caret ${analysisOpen ? "sidebar-caret--open" : ""}`} size={14} aria-hidden="true" />
                </button>
                <div id={analysisId} className="sidebar-submenu" hidden={!analysisOpen}>{links}</div>
              </> : <Popover label={item.label} trigger={<Icon size={20} aria-hidden="true" />} side="right" openOnHover
                buttonClassName="nav-item sems-shell-item" className="sidebar-flyout sidebar-flyout--sems">
                {close => <nav aria-label={item.label}>{item.children?.map(child => <a key={child.href} href={child.href} target="_blank" rel="noreferrer" className="sidebar-submenu-item sems-shell-item" onClick={close}>{child.label}</a>)}</nav>}
              </Popover>}
            </div>;
          }
          return <a key={item.label} href={item.href} target="_blank" rel="noreferrer" className="nav-item sems-shell-item" title={item.label} aria-label={item.label}>
            <Icon size={20} aria-hidden="true" /><span>{item.label}</span>
          </a>;
        })}
      </div>

      <div className="nav-section nav-section--emps">
        <div className="sidebar-group">
          {expanded ? <>
            <button type="button" className={`nav-item emps-rail-trigger ${activeModule ? "nav-item--active" : ""}`} aria-label="Abrir modulo EMPS" aria-expanded={empsOpen} aria-controls={empsId} onClick={() => setEmpsOpen(value => !value)}>
              <EmpsLogo /><span>EMPS</span><ChevronDown className={`sidebar-caret ${empsOpen ? "sidebar-caret--open" : ""}`} size={14} aria-hidden="true" />
            </button>
            <div id={empsId} className="sidebar-submenu" hidden={!empsOpen}>{empsLinks()}</div>
          </> : <Popover label="Abrir modulo EMPS" trigger={<EmpsLogo />} side="right" openOnHover
            buttonClassName={`nav-item emps-rail-trigger ${activeModule ? "nav-item--active" : ""}`} className="sidebar-flyout sidebar-flyout--emps">
            {close => <nav aria-label="Modulo EMPS">{empsLinks(close)}</nav>}
          </Popover>}
        </div>
      </div>
    </nav>

    <div className="sidebar-footer">
      <a href="https://semsplus.goodwe.com/configure/#/organization_management" target="_blank" rel="noreferrer" className="nav-item sems-shell-item" title="Gestão da organização" aria-label="Gestão da organização">
        <Layers2 size={20} aria-hidden="true" /><span>Gestão da organização</span>
      </a>
      <button type="button" className="sidebar-toggle" title={expanded ? "Recolher menu" : "Expandir menu"} aria-label={expanded ? "Recolher menu" : "Expandir menu"} aria-expanded={expanded} onClick={onToggle}>
        {expanded ? <ChevronLeft size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
      </button>
    </div>
  </aside>;
}
