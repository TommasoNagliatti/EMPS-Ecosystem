import { StationWizard } from '@/components/stations/StationWizard';
import { stationWizardFont } from '@/components/stations/station-wizard-font';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <div className={stationWizardFont.className}><StationWizard id={id} /></div>;
}
