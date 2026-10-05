import {StationRfid} from '@/components/stations/StationRfid';
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <StationRfid id={id}/>;}
