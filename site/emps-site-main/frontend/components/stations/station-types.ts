export type AssetRow=Record<string,string|number|undefined>;
export type Availability={alwaysOpen:boolean;windows:{day:number;start:string;end:string}[]};
export type Draft={ [key:string]:unknown; name:string;visibility:'PUBLIC'|'PRIVATE';batteries:AssetRow[];solarAssets:AssetRow[];chargers:AssetRow[];amenities:string[];availability:Availability;};
export type Station={id:string;name:string;street:string;addressNumber:string;city:string;state:string;status:string;reviewState:string;visibility:'PUBLIC'|'PRIVATE';technicalReviewRequired:boolean;membershipRole:string;gieStatus?:string;_count?:{chargers:number};photos:{id:string;position:number;storageKey?:string}[];reviews?:{state:string;reason?:string;proposedConfig:unknown}[];[key:string]:unknown};
export const reviewLabels:Record<string,string>={DRAFT:'Rascunho',PENDING_REVIEW:'Aguardando validação',APPROVED:'Aprovada',CHANGES_REQUESTED:'Correções solicitadas',REJECTED:'Rejeitada',SUSPENDED:'Suspensa'};
export const amenities=['Café','Restaurante','Banheiro','Wi-Fi','Área infantil','Shopping','Hotel','Parque','Loja','Conveniência','24h','Acessibilidade'];
export const emptyDraft=():Draft=>({name:'Nova estação',countryCode:'BR',timezone:'America/Sao_Paulo',visibility:'PRIVATE',venueType:'outro',batteries:[],solarAssets:[],chargers:[],amenities:[],availability:{alwaysOpen:true,windows:[]},guestAllowed:false});
export const scalarKeys=['name','description','venueType','visibility','countryCode','postalCode','state','city','neighborhood','street','addressNumber','complement','latitude','longitude','timezone','openingHours','guestAllowed','powerLimitKw','reservationRatePerHour'];
const pick=(row:Record<string,unknown>,keys:string[])=>Object.fromEntries(keys.filter(k=>row[k]!==null&&row[k]!==undefined).map(k=>[k,row[k]]));
export function draftFrom(row:Station):Draft{
 const draft={...emptyDraft(),...pick(row,scalarKeys)} as Draft;
 for(const k of ['latitude','longitude','powerLimitKw','reservationRatePerHour'])if(draft[k]!==undefined)draft[k]=Number(draft[k]);
 draft.availability=(row.availability as Availability)||draft.availability;
 draft.amenities=((row.amenities as {amenityName:string}[])||[]).map(a=>a.amenityName);
 const assets=(key:string,keys:string[],numbers:string[])=>((row[key] as Record<string,unknown>[])||[]).filter(a=>a.status!=='INACTIVE'&&a.administrativeStatus!=='DISABLED').map(a=>{const result=pick(a,keys) as AssetRow;numbers.forEach(k=>{if(result[k]!==undefined)result[k]=Number(result[k])});return result});
 draft.batteries=assets('batteries',['id','name','capacityKwh','maxChargeKw','maxDischargeKw','socPercent','minSocPercent','maxSocPercent','efficiency','manufacturer','model','status','integrationRef'],['capacityKwh','maxChargeKw','maxDischargeKw','socPercent','minSocPercent','maxSocPercent','efficiency']);
 draft.solarAssets=assets('solarAssets',['id','name','installedKwp','acPowerKw','inverter','manufacturer','model','integrationRef','status'],['installedKwp','acPowerKw']);
 draft.chargers=assets('chargers',['id','name','ocppIdentity','serialNumber','manufacturer','model','firmwareVersion','connectorType','powerKw','administrativeStatus'],['id','powerKw']);
 for(const c of draft.chargers){const source=(row.chargers as Record<string,unknown>[]).find(a=>String(a.id)===String(c.id));const tariff=(source?.tariffs as {status:string;basePricePerKwh:string}[]|undefined)?.find(t=>t.status==='ACTIVE');if(tariff)c.pricePerKwh=Number(tariff.basePricePerKwh)}
 const policy=row.reservationPolicy as {text?:string}|null;if(policy?.text)draft.reservationPolicyText=policy.text;
 return draft;
}
