import {WebCharge} from '@/components/charge/WebCharge';
export const metadata={title:'Web Charge',description:'Carregue seu veículo com a EMPS, sem instalar um aplicativo.'};
export default async function Page({params}:{params:Promise<{token:string}>}){const {token}=await params;return <WebCharge token={token}/>}
