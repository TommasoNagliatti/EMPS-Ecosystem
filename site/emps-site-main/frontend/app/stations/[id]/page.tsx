import {StationWizard} from '@/components/stations/StationWizard';
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <StationWizard id={id}/>;}
