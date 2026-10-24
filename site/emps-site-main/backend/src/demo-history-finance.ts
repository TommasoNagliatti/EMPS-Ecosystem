import {createHash} from 'node:crypto';
import {Prisma} from '@prisma/client';

export type DemoChannel='APP_EMPS'|'WEB_CHARGE'|'CAIXA';
export type DemoMethod='PIX'|'CREDIT_CARD'|'DEBIT_CARD'|'CASH';
export type DemoFinancialScenario={
  version:string;
  seed:number;
  tariffPerKwh:string;
  fixedFee:string;
  energyCostPerKwh:string;
  channelWeights:Record<DemoChannel,number>;
  methodWeights:Record<DemoChannel,Partial<Record<DemoMethod,number>>>;
};

export const DEFAULT_DEMO_SCENARIO:DemoFinancialScenario={
  version:'demo-finance-v1',seed:20261015,tariffPerKwh:'2.20',fixedFee:'0.00',energyCostPerKwh:'0.80',
  channelWeights:{APP_EMPS:50,WEB_CHARGE:30,CAIXA:20},
  methodWeights:{
    APP_EMPS:{PIX:45,CREDIT_CARD:40,DEBIT_CARD:15},
    WEB_CHARGE:{PIX:40,CREDIT_CARD:40,DEBIT_CARD:20},
    CAIXA:{CASH:60,DEBIT_CARD:20,CREDIT_CARD:15,PIX:5},
  },
};

function randomUnit(seed:number,identity:string,dimension:string){
  const hash=createHash('sha256').update(`${seed}:${identity}:${dimension}`).digest();
  return hash.readUIntBE(0,6)/0x1_0000_0000_0000;
}

function choose<T extends string>(weights:Record<T,number>|Partial<Record<T,number>>,random:number):T{
  const entries=Object.entries(weights).filter((entry):entry is [T,number]=>typeof entry[1]==='number'&&Number.isFinite(entry[1])&&entry[1]>0);
  const total=entries.reduce((sum,[,weight])=>sum+weight,0);
  if(!total)throw new Error('Distribuição demonstrativa vazia');
  let cursor=random*total;
  for(const [value,weight] of entries){cursor-=weight;if(cursor<0)return value;}
  return entries[entries.length-1][0];
}

function nonnegativeDecimal(value:string,label:string){
  let decimal:Prisma.Decimal;
  try{decimal=new Prisma.Decimal(value);}catch{throw new Error(`${label} inválido`);}
  if(!decimal.isFinite()||decimal.isNegative())throw new Error(`${label} inválido`);
  return decimal;
}

export function demoFinancials(session:{sourceSessionId:string;status:'COMPLETED'|'UNSERVED';deliveredEnergyKwh:string;endedAt:Date|null},
  scenario:DemoFinancialScenario){
  if(!Number.isSafeInteger(scenario.seed))throw new Error('Semente demonstrativa inválida');
  const energy=nonnegativeDecimal(session.deliveredEnergyKwh,'Energia entregue');
  const tariff=nonnegativeDecimal(scenario.tariffPerKwh,'Tarifa');
  const fixed=nonnegativeDecimal(scenario.fixedFee,'Taxa fixa');
  const costRate=nonnegativeDecimal(scenario.energyCostPerKwh,'Custo energético');
  if(session.status==='UNSERVED'&&!energy.isZero())throw new Error('Tentativa sem atendimento possui energia entregue');
  if(session.status==='UNSERVED'||energy.isZero()){
    return {billable:false,tariffPerKwh:tariff.toFixed(4),fixedFee:'0.00',energyCostPerKwh:costRate.toFixed(4),
      costAmount:'0.00',amount:'0.00',payment:null};
  }
  if(!session.endedAt||Number.isNaN(session.endedAt.getTime()))throw new Error('Recarga sem encerramento não pode gerar pagamento demonstrativo');
  const channel=choose(scenario.channelWeights,randomUnit(scenario.seed,session.sourceSessionId,'channel'));
  const method=choose(scenario.methodWeights[channel],randomUnit(scenario.seed,session.sourceSessionId,'method'));
  const amount=energy.mul(tariff).add(fixed).toDecimalPlaces(2,Prisma.Decimal.ROUND_HALF_UP);
  const cost=energy.mul(costRate).toDecimalPlaces(2,Prisma.Decimal.ROUND_HALF_UP);
  const sourcePaymentId=`SIM-${createHash('sha256').update(`${scenario.version}:${scenario.seed}:${session.sourceSessionId}`).digest('hex').slice(0,24)}`;
  return {billable:true,tariffPerKwh:tariff.toFixed(4),fixedFee:fixed.toFixed(2),energyCostPerKwh:costRate.toFixed(4),
    costAmount:cost.toFixed(2),amount:amount.toFixed(2),payment:{sourcePaymentId,channel,method,amount:amount.toFixed(2),settledAt:session.endedAt}};
}
