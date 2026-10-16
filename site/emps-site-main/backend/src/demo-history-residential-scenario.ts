import {createHash} from 'node:crypto';
import type {DemoDatasetKind} from './demo-history-datasets';
import {DEFAULT_DEMO_SCENARIO,demoFinancials} from './demo-history-finance';

/** This version changes only the interpretation of the original 2025 sessions. */
export const RESIDENTIAL_SCENARIO_VERSION='residential-owner-visitor-v2';
export const RESIDENTIAL_SCENARIO_RULE={
  version:RESIDENTIAL_SCENARIO_VERSION,
  visitorEveryNthSourceSession:4,
  tariffPerKwh:'2.20',
  energyCostPerKwh:'0.80',
  ownerCredential:'HYPOTHETICAL_RFID',
  ownerRevenue:'0.00',
} as const;

const pricing={...DEFAULT_DEMO_SCENARIO,version:RESIDENTIAL_SCENARIO_VERSION,
  tariffPerKwh:RESIDENTIAL_SCENARIO_RULE.tariffPerKwh,
  energyCostPerKwh:RESIDENTIAL_SCENARIO_RULE.energyCostPerKwh};

/** Stable fictional labels; no User, RFID credential, CPF, or identifying source data. */
export function fictionalDemoDriver(kind:DemoDatasetKind,sourceSessionId:string){
  const code=createHash('sha256').update(`${kind}:${sourceSessionId}`).digest('hex').slice(0,12).toUpperCase();
  return {driverKey:`DEMO-${kind}-${code}`,driverName:`Motorista demonstrativo ${code.slice(0,4)}`};
}

type Session={
  sourceSessionId:string;
  status:'COMPLETED'|'UNSERVED';
  deliveredEnergyKwh:string;
  endedAt:Date|null;
};

export function residentialScenarioFor(session:Session){
  const match=/^DEMO_CASA_001_S(\d{5})$/.exec(session.sourceSessionId);
  if(!match)throw new Error(`Sessão residencial fora do formato original: ${session.sourceSessionId}`);
  const ordinal=Number(match[1]);
  if(!Number.isSafeInteger(ordinal)||ordinal<1)throw new Error('Ordem da sessão residencial inválida');
  const financials=demoFinancials(session,pricing);
  const common={scenarioVersion:RESIDENTIAL_SCENARIO_VERSION,
    tariffPerKwh:financials.tariffPerKwh,
    energyCostPerKwh:financials.energyCostPerKwh,
    currency:'BRL' as const,origin:'SIMULATED' as const};
  if(!financials.billable){
    return {...common,usageKind:'UNSERVED' as const,credentialKind:'NONE' as const,
      ...fictionalDemoDriver('CASA',session.sourceSessionId),
      amount:'0.00',costAmount:'0.00',channel:null,method:null};
  }
  if(ordinal%RESIDENTIAL_SCENARIO_RULE.visitorEveryNthSourceSession===0){
    const code=String(ordinal).padStart(5,'0');
    return {...common,usageKind:'VISITOR' as const,credentialKind:'NONE' as const,
      driverKey:`DEMO-CASA-VISITOR-${code}`,
      driverName:`Visitante demonstrativo ${code}`,
      amount:financials.amount,costAmount:financials.costAmount,
      channel:financials.payment!.channel,method:financials.payment!.method};
  }
  return {...common,usageKind:'OWNER' as const,credentialKind:'HYPOTHETICAL_RFID' as const,
    driverKey:'DEMO-CASA-OWNER-001',driverName:'Proprietário demonstrativo',
    amount:'0.00',costAmount:financials.costAmount,channel:null,method:null};
}
