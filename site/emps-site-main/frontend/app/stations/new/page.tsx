import { StationWizard } from '@/components/stations/StationWizard';
import { stationWizardFont } from '@/components/stations/station-wizard-font';

export default function Page() {
  return <div className={stationWizardFont.className}><StationWizard /></div>;
}
