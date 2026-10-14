import { notFound } from 'next/navigation';
import { RoleDashboard } from '@/components/dashboard/RoleDashboard';
import { stationWizardFont } from '@/components/stations/station-wizard-font';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) notFound();
  return <div className={stationWizardFont.className}><RoleDashboard key={id} stationId={id} /></div>;
}
