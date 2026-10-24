import { AccountSettings } from '@/components/account/AccountSettings';
import { settingsTab } from '@/components/account/account-model';

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const params = await searchParams;
  return <AccountSettings tab={settingsTab(params.tab)} />;
}

