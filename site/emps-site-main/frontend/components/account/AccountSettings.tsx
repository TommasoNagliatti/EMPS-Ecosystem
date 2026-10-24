'use client';

import { Eye, EyeOff, KeyRound, Palette, Save, ShieldCheck, UserRound, Users } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { ThemeSelector } from '@/components/theme/ThemeSelector';
import { CreateAdminForm } from '@/components/operations/CreateAdminForm';
import { profileInitials, roleLabels, type SettingsTab, type ProfileSummary } from './account-model';
import { useProfileSummary } from './use-profile-summary';
import styles from './account-settings.module.css';

const sections = [
  { tab: 'appearance', label: 'Aparência', icon: Palette },
  { tab: 'profile', label: 'Meu perfil', icon: UserRound },
  { tab: 'account', label: 'Minha conta', icon: ShieldCheck },
  { tab: 'security', label: 'Senha e segurança', icon: KeyRound },
  { tab: 'administration', label: 'Administradores', icon: Users },
] as const;

function UnavailableSave() {
  return <footer className={styles.footer}><span>Alterações indisponíveis no momento</span><button type="button" disabled title="Salvamento indisponível"><Save size={15} aria-hidden="true" />Salvar alterações</button></footer>;
}

function ProfileForm({ profile }: { profile: ProfileSummary | null }) {
  const [name, setName] = useState(profile?.nome ?? '');
  return <form onSubmit={event => event.preventDefault()}>
    <div className={styles.avatarRow}><span className={styles.avatar}>{profileInitials(profile?.nome)}</span><div><strong>{profile?.nome ?? 'Minha conta'}</strong><span>{profile ? roleLabels[profile.role] : 'EMPS'}</span></div></div>
    <div className={styles.fields}>
      <label>Nome<input autoComplete="off" value={name} onChange={event => setName(event.target.value)} maxLength={100} /></label>
      <label>E-mail<input type="email" readOnly value={profile?.email ?? ''} /></label>
    </div>
    <UnavailableSave />
  </form>;
}

function PasswordForm() {
  const [visible, setVisible] = useState(false);
  return <form onSubmit={event => event.preventDefault()} autoComplete="off">
    <div className={styles.fields}>
      {['Senha atual', 'Nova senha', 'Confirmar nova senha'].map(label => <label key={label}>{label}<div className={styles.password}>
        <input aria-label={label} type={visible ? 'text' : 'password'} autoComplete="off" maxLength={72} />
        <button type="button" title={visible ? 'Ocultar senhas' : 'Mostrar senhas'} aria-label={visible ? 'Ocultar senhas' : 'Mostrar senhas'} aria-pressed={visible} onClick={() => setVisible(value => !value)}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button>
      </div></label>)}
    </div>
    <UnavailableSave />
  </form>;
}

export function AccountSettings({ tab }: { tab: SettingsTab }) {
  const profile = useProfileSummary();
  const available = sections.filter(section => section.tab !== 'administration' || profile?.role === 'admin');
  const current = available.find(section => section.tab === tab) ?? sections[0];
  const selectedTab = current.tab;
  const Icon = current.icon;
  return <AppShell eyebrow="EMPS" title="Configurações" showEmpsHeaderLogo>
    <section className={styles.page}>
      <header className={styles.heading}><h1>Configurações</h1><Link href="/stations">Minhas instalações</Link></header>
      <div className={styles.layout}>
        <nav className={styles.navigation} aria-label="Seções de configurações">{available.map(section => <Link href={`/settings?tab=${section.tab}`} key={section.tab} aria-current={selectedTab === section.tab ? 'page' : undefined}><section.icon size={17} aria-hidden="true" />{section.label}</Link>)}</nav>
        <div className={styles.content}>
          <header className={styles.sectionHeading}><Icon size={19} aria-hidden="true" /><h2>{current.label}</h2>{selectedTab !== 'appearance' && selectedTab !== 'administration' && <small>Em breve</small>}</header>
          {selectedTab === 'profile' && <ProfileForm key={profile?.usuarioId ?? 'empty'} profile={profile} />}
          {selectedTab === 'account' && <><dl className={styles.details}><div><dt>E-mail da conta</dt><dd>{profile?.email ?? 'Não disponível'}</dd></div><div><dt>Identificador</dt><dd>{profile?.usuarioId ?? 'Não disponível'}</dd></div><div><dt>Perfil de acesso</dt><dd>{profile ? roleLabels[profile.role] : 'Não disponível'}</dd></div></dl><UnavailableSave /></>}
          {selectedTab === 'security' && <PasswordForm />}
          {selectedTab === 'appearance' && <div className={styles.appearance}><span>Tema do site e do mapa</span><ThemeSelector /></div>}
          {selectedTab === 'administration' && <CreateAdminForm className={styles.administration} />}
        </div>
      </div>
    </section>
  </AppShell>;
}
