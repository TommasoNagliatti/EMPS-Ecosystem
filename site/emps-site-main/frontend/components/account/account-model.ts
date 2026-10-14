import type { FrontSession } from '@/domain/emps';

export const accountTabs = ['profile', 'account', 'security', 'appearance'] as const;
export type AccountTab = typeof accountTabs[number];
export const settingsTabs = ['appearance', ...accountTabs.filter(tab => tab !== 'appearance'), 'administration'] as const;
export type SettingsTab = AccountTab | 'administration';
export type ProfileSummary = Pick<FrontSession, 'nome' | 'email' | 'role' | 'usuarioId'>;

export function accountTab(value: unknown): AccountTab {
  return accountTabs.includes(value as AccountTab) ? value as AccountTab : 'profile';
}

export function settingsTab(value: unknown): SettingsTab {
  return settingsTabs.includes(value as SettingsTab) ? value as SettingsTab : 'appearance';
}

export function profileSummary(session: FrontSession | null): ProfileSummary | null {
  return session ? { nome: session.nome, email: session.email, role: session.role, usuarioId: session.usuarioId } : null;
}

export function profileInitials(name?: string) {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  return parts.length ? `${parts[0][0]}${parts.length > 1 ? parts[parts.length - 1][0] : ''}`.toUpperCase() : 'EM';
}

export const roleLabels = { admin: 'Administrador', goodwe: 'GoodWe', operador: 'Operador', proprietario: 'Proprietário' };
