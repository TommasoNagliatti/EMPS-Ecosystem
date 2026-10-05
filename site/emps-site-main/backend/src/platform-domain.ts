export type Availability = {alwaysOpen:boolean; windows:{day:number;start:string;end:string}[]};
export function validateTimezone(zone:string) { new Intl.DateTimeFormat('en',{timeZone:zone}).format(); }
export function isWithinAvailability(config:unknown, timezone:string, from:Date, to:Date):boolean {
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to<=from || to.getTime()-from.getTime()>7*86400000) return false;
  const schedule=config as Availability|null;
  if (!schedule) return false; // Legacy hours have no machine-readable guarantee.
  if(schedule.alwaysOpen) return true;
  const fmt=new Intl.DateTimeFormat('en-US',{timeZone:timezone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const minute=(s:string)=>Number(s.slice(0,2))*60+Number(s.slice(3));
  for(let t=Math.floor(from.getTime()/60000)*60000;t<to.getTime();t+=60000){
    const parts=Object.fromEntries(fmt.formatToParts(new Date(t)).map(p=>[p.type,p.value]));
    const day=days.indexOf(parts.weekday),m=Number(parts.hour)*60+Number(parts.minute);
    if(!schedule.windows.some(w=>{const a=minute(w.start),b=minute(w.end);return a===b?w.day===day:a<b?w.day===day&&m>=a&&m<b:(w.day===day&&m>=a)||((w.day+1)%7===day&&m<b)}))return false;
  }return true;
}
export function aggregateStorage(batteries:{capacityKwh:unknown;socPercent:unknown;status?:string}[]) {
  const active=batteries.filter(b=>b.status!=='INACTIVE');
  const capacityKwh=active.reduce((sum,b)=>sum+Number(b.capacityKwh),0);
  const known=active.every(b=>b.socPercent!==null&&b.socPercent!==undefined);
  const storedKwh=known?active.reduce((sum,b)=>sum+Number(b.capacityKwh)*Number(b.socPercent)/100,0):null;
  return {capacityKwh,storedKwh,socPercent:capacityKwh>0&&storedKwh!==null?storedKwh/capacityKwh*100:null,count:active.length};
}
