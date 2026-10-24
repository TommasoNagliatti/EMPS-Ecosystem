import { redirect } from 'next/navigation';
import { accountTab } from '@/components/account/account-model';

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const params = await searchParams;
  redirect(`/settings?tab=${accountTab(params.tab)}`);
}
