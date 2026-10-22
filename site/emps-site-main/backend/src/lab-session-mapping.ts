/** Explicit presentation wiring; never infer a physical charger from GIE allocation. */
export const COMMERCIAL_LAB_CHANNELS = {
  EV1: { publicCode:'CH-f2f059af5117b95fb970', gieEvse:'EVSE1' },
  EV2: { publicCode:'CH-26f5af4e137bbe735ed5', gieEvse:'EVSE2' },
} as const;

export async function commercialSessionChannels(db:any, now:Date) {
  const chargers = await db.charger.findMany({where:{stationId:13,publicCode:{in:Object.values(COMMERCIAL_LAB_CHANNELS).map(x=>x.publicCode)}},
    select:{id:true,stationId:true,publicCode:true}});
  const sessions = chargers.length ? await db.labChargeSession.findMany({where:{stationId:13,chargerId:{in:chargers.map((c:any)=>c.id)},
    status:'CHARGING',startedAt:{lte:now},endedAt:null,autoStopAt:{gt:now}},
    select:{id:true,intentId:true,stationId:true,chargerId:true,status:true,startedAt:true,endedAt:true,autoStopAt:true,simulatedPowerKw:true}}) : [];
  const intents = sessions.length ? await db.labChargeIntent.findMany({where:{id:{in:sessions.map((s:any)=>s.intentId)},stationId:13},
    select:{id:true,stationId:true,chargerId:true,status:true,expiresAt:true}}) : [];
  return Object.fromEntries(Object.entries(COMMERCIAL_LAB_CHANNELS).map(([channel,mapping])=>{
    const charger=chargers.find((c:any)=>c.publicCode===mapping.publicCode && c.stationId===13);
    const active=sessions.filter((s:any)=>s.chargerId===charger?.id && s.stationId===13 && s.status==='CHARGING' &&
      !s.endedAt && s.startedAt<=now && s.autoStopAt>now);
    // Ambiguous concurrent sessions fail closed. Intent expiry is admission expiry;
    // an admitted session's authorization lease is its existing autoStopAt deadline.
    const session=active.length===1 ? active[0] : null;
    const intent=session && intents.find((i:any)=>i.id===session.intentId && i.stationId===13 && i.chargerId===charger.id &&
      i.status==='AUTHORIZED' && i.expiresAt>=session.startedAt);
    return [channel,{chargerId:charger?.id ?? null,chargerCode:mapping.publicCode,gieEvse:mapping.gieEvse,
      sessionPowerKw:session ? Number(session.simulatedPowerKw) : 0,sessionAuthorized:!!session,sessionId:session?.id ?? null,sessionExpiresAt:session?.autoStopAt?.toISOString() ?? null,
      sessionExpiresAtMs:session?.autoStopAt?.getTime() ?? null,
      operationalAuthorized:!!intent,authorizationId:intent?.id ?? null,sessionSource:'EXISTING_LAB_CHARGE_SESSION'}];
  }));
}

/** Session indication only. This is NOT electrical permission or a GIE decision. */
export function sessionIndication(channel: {sessionAuthorized:boolean; operationalAuthorized:boolean}) {
  return channel.sessionAuthorized && channel.operationalAuthorized;
}
export function maquetePresentation(mode: unknown, valid: boolean) {
  const normal = valid && mode === 'NORMAL';
  return { gieMode: mode ?? 'UNAVAILABLE', source: 'ILLUSTRATIVE_ONLY', participatesInBalance:false,
    solarSharePct:normal ? 80 : null, gridSharePct:normal ? 20 : null,
    label:normal ? 'Ilustrativo: solar 80%, rede 20%; nao e resultado GIE' : null };
}
