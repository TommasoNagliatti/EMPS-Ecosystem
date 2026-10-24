import {createHash} from 'node:crypto';
import {DEFAULT_DEMO_SCENARIO, type DemoChannel, type DemoMethod} from './demo-history-finance';
import {COMMERCIAL_SHARED_ENERGY_SHA256,COMMERCIAL_SHARED_SOURCE_GROUP} from './demo-history-datasets';

/** Audited supplemental package. The original GIE CSVs remain the imported facts. */
export const PREDIO_SUPPLIED_PACKAGE={
  scenario:'predio-comercial-financeiro-v1',
  seed:20261017,
  sourceDemandSha256:COMMERCIAL_SHARED_ENERGY_SHA256,
  sharedSourceGroup:COMMERCIAL_SHARED_SOURCE_GROUP,
  suppliedSessions:{rows:2917,sha256:'e06e950eb482bd41c14b87068862da323d85f2e02249368c66517342331e2e3f'},
  suppliedIntervals:{rows:17376,sha256:'ca0a5bb8ef889ffc6002512aa0597292bb8a698460f33eabacd30725e4780b2a'},
  suppliedMonthly:{rows:6,sha256:'01641410c6cc8a01204e3f23c25e6b7c147c81b48dfcaf59f6b53fd6725d1681'},
  suppliedManifest:{sha256:'f3f3fd11f14725360706c26b16e9c05cd6e538da025dccb2ad583dfe640f3ebe'},
  sourceSessionsSha256:'2bf7460dac23de08f595394a6d781b7c13a0e4681ee646be86f054836e9868d1',
  suppliedRevenueBrl:'101381.50',
  suppliedEstimatedCostBrl:'36866.29',
  suppliedEstimatedMarginBrl:'64515.21',
  suppliedEnergyKwh:'46082.44141781',
  sourceRevenueBrl:'101381.31',
  sourceEstimatedCostBrl:'36865.81',
  sourceEstimatedMarginBrl:'64515.50',
  sourceEnergyKwh:'46082.44141759',
  attribution:'SUPPLIED_AGGREGATE_QUOTAS_REASSIGNED_DETERMINISTICALLY_TO_ORIGINAL_EV_IDS',
} as const;

export const PREDIO_FINANCIAL_SCENARIO={
  ...DEFAULT_DEMO_SCENARIO,
  version:PREDIO_SUPPLIED_PACKAGE.scenario,
  seed:PREDIO_SUPPLIED_PACKAGE.seed,
};

// These are joint channel/method counts from the delivered synthetic CSV. No
// individual PCSIM row can be linked factually to an original EV_ session.
export const PREDIO_PAYMENT_QUOTAS=[
  {channel:'APP_EMPS',method:'PIX',count:665},
  {channel:'APP_EMPS',method:'CREDIT_CARD',count:561},
  {channel:'APP_EMPS',method:'DEBIT_CARD',count:228},
  {channel:'WEB_CHARGE',method:'PIX',count:355},
  {channel:'WEB_CHARGE',method:'CREDIT_CARD',count:354},
  {channel:'WEB_CHARGE',method:'DEBIT_CARD',count:190},
  {channel:'CAIXA',method:'CASH',count:326},
  {channel:'CAIXA',method:'CREDIT_CARD',count:77},
  {channel:'CAIXA',method:'DEBIT_CARD',count:131},
  {channel:'CAIXA',method:'PIX',count:30},
] as const satisfies ReadonlyArray<{channel:DemoChannel;method:DemoMethod;count:number}>;

export type PredioPaymentAttribution={channel:DemoChannel;method:DemoMethod};

/** Assign only synthetic payment labels; source timestamps, EVSEs and kWh are untouched. */
export function predioPaymentAttributions(sourceSessionIds:string[]):Map<string,PredioPaymentAttribution>{
  const total=PREDIO_PAYMENT_QUOTAS.reduce((sum,bucket)=>sum+bucket.count,0);
  if(sourceSessionIds.length!==total||new Set(sourceSessionIds).size!==total)
    throw new Error('Sessões originais do Prédio não reconciliam com as cotas fictícias entregues');
  const ordered=sourceSessionIds.map(id=>({id,
    rank:createHash('sha256').update(`${PREDIO_FINANCIAL_SCENARIO.seed}:${id}:predio-payment-attribution`).digest('hex')}))
    .sort((left,right)=>left.rank.localeCompare(right.rank)||left.id.localeCompare(right.id));
  const result=new Map<string,PredioPaymentAttribution>();
  let cursor=0;
  for(const bucket of PREDIO_PAYMENT_QUOTAS){
    for(let i=0;i<bucket.count;i++)result.set(ordered[cursor++].id,
      {channel:bucket.channel,method:bucket.method});
  }
  if(cursor!==ordered.length)throw new Error('Cotas fictícias incompletas');
  return result;
}
