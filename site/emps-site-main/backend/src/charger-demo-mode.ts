/** Local illustration only; never changes the trained worker or electrical permissions. */
const enabled = new Set<number>();
const queues = new Map<number, Promise<unknown>>();
export const chargerDemoEnabled = (station:number) => enabled.has(station);
export function setChargerDemo(station:number,value:boolean) { if(value) enabled.add(station); else enabled.delete(station); }
export async function withChargerModeLock<T>(station:number, task:()=>Promise<T>):Promise<T> {
  const previous=queues.get(station) ?? Promise.resolve();
  const next=previous.catch(()=>undefined).then(task);queues.set(station,next);
  try {return await next;} finally {if(queues.get(station)===next) queues.delete(station);}
}
export function chargerDemoEnergy(at:Date, evKw:number) {
  // Stable for ten seconds: pseudo-random illustration, not weather or GIE output.
  const step=Math.floor(at.getTime()/10000);
  const buildingPowerKw=5+(Math.sin(step*1.73)+1)*2;
  const fraction=0.7+(Math.sin(step*0.83)+1)*0.1;
  const demand=buildingPowerKw+evKw, solarPowerKw=demand*fraction;
  return {version:'CHARGER_DEMO_ILLUSTRATION_V1',provenance:'SIMULATED' as const,at:at.toISOString(),
    assumption:'DEMONSTRACAO DE CARREGADORES: energia ilustrativa, nao e resultado GIE ou medicao.',
    solarPowerKw,gridPowerKw:demand-solarPowerKw,buildingPowerKw,chargerPowerKw:evKw,
    batteryPowerKw:0,balanceResidualKw:0};
}
