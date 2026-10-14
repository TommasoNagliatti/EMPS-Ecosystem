'use client';

import { KeyRound, LogOut, Settings2, ShieldCheck, UserRound } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/services/emps-api';
import { Popover } from '@/components/ui/Popover';
import { profileInitials, roleLabels } from './account-model';
import { useProfileSummary } from './use-profile-summary';
import styles from './profile-menu.module.css';

const links = [
  { href: '/settings?tab=profile', label: 'Meu perfil', icon: UserRound },
  { href: '/settings?tab=account', label: 'Minha conta', icon: ShieldCheck },
  { href: '/settings?tab=security', label: 'Senha e segurança', icon: KeyRound },
  { href: '/settings', label: 'Configurações', icon: Settings2 },
];

export function ProfileMenu() {
  const profile = useProfileSummary();
  return <Popover label="Abrir configurações do perfil" trigger={<span>{profileInitials(profile?.nome)}</span>} buttonClassName="sems-profile-button" className={styles.menu}>
    {close => <>
      <header className={styles.identity}>
        <strong>{profile?.nome ?? 'Minha conta'}</strong>
        <span>{profile?.email ?? 'EMPS'}</span>
        {profile && <small>{roleLabels[profile.role] ?? profile.role}</small>}
      </header>
      <nav aria-label="Preferências da conta" className={styles.links}>
        {links.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={close}><Icon size={16} aria-hidden="true" />{label}</Link>)}
      </nav>
      <button className={styles.logout} type="button" onClick={() => { close(); void api.logout(); }}><LogOut size={16} aria-hidden="true" />Sair</button>
    </>}
  </Popover>;
}
