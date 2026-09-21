import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {calculateSession,invoice,ledgerOf,recordEnergy,tariffQuote,unknownFacts,type Ledger,type Interval} from '../src/tariff-engine';
const at=(h:number,m=0)=>new Date(Date.UTC(2026,8,19,h,m)).toISOString();
const interval=(start:string,end:string,kwh:string,grid=false,peak=false):Interval=>({...unknownFacts(start),start_at:start,end_at:end,energy_kwh:kwh,grid_support_for_ev:grid,high_demand:peak});
test('V1 mantém os quatro estados e o exemplo comercial fornecido',()=>{
 assert.deepEqual([tariffQuote(),tariffQuote({...unknownFacts(),high_demand:true}),tariffQuote({...unknownFacts(),grid_support_for_ev:true}),tariffQuote({...unknownFacts(),grid_support_for_ev:true,high_demand:true})].map(q=>q.current_tariff_per_kwh),['1.99','2.09','2.19','2.29']);
 const b=calculateSession('ref',[interval(at(10),at(10,15),'5'),interval(at(10,15),at(10,30),'4',true),interval(at(10,30),at(10,45),'3',false,true),interval(at(10,45),at(11),'2',true,true)],at(11),at(11,40));
 assert.equal(b.customer.energy_amount,'29.56');assert.equal(b.customer.overstay_fee,'6.25');assert.equal(b.customer.total_amount,'35.81');assert.equal(b.internal_settlement_reference.platform_fee_reference,'1.40');
});
test('permanência respeita carência, minuto iniciado, teto e timestamps',()=>{
 assert.equal(calculateSession('x',[],at(10),at(10,15)).customer.overstay_fee,'0.00');
 assert.equal(calculateSession('x',[],at(10),'2026-09-19T10:15:00.001Z').customer.overstay_fee,'0.25');
 assert.equal(calculateSession('x',[],at(10),at(15)).customer.overstay_fee,'20.00');
 assert.throws(()=>calculateSession('x',[],at(10),at(9)));assert.throws(()=>calculateSession('x',[],null,at(10)));
 assert.throws(()=>calculateSession('x',[interval(at(10),at(11),'-1')]));
 assert.throws(()=>calculateSession('x',[interval(at(10),at(11),'1'),interval(at(10,30),at(12),'2')]));
});
test('polling acumula decimal sem arredondar dinheiro e replay não duplica intervalo',()=>{
 let l:Ledger={tariff_version:'SP_ENEL_PROTO_V1',phase:'collecting',intervals:[],meter_energy_kwh:'0',last_at:at(10),facts:unknownFacts(at(10))};
 for(let n=1;n<=12;n++)l=recordEnergy(l,String(n/1000),new Date(Date.parse(at(10))+n*5000),unknownFacts(at(10)));
 assert.equal(l.intervals.length,1);assert.equal(calculateSession('s',l.intervals).customer.energy_amount,'0.02');
 assert.deepEqual(recordEnergy(l,'.012',new Date(l.last_at),l.facts),l);assert.throws(()=>recordEnergy(l,'.02',new Date(l.last_at),l.facts));assert.throws(()=>recordEnergy(l,'0',new Date(Date.parse(l.last_at)+1),l.facts));
 assert.equal(ledgerOf({tariffVersion:null,billingSnapshot:null}),null);
 const frozen={...l,phase:'frozen' as const,breakdown:calculateSession('s',l.intervals,at(11),at(11,20))};assert.deepEqual(invoice({id:'s',tariffVersion:frozen.tariff_version,billingSnapshot:frozen}),frozen.breakdown);
});
test('port TypeScript tem paridade monetária com o Python original em 100 cenários',()=>{
 const cases=Array.from({length:100},(_,n)=>({session_id:'parity-'+n,intervals:Array.from({length:4},(_,j)=>interval(at(10,j*10),at(10,j*10+10),((n*17+j*13)/997).toFixed(6),!!(n&1),!!(j&1))),charge_completed_at:at(11),disconnected_at:new Date(Date.parse(at(11))+n*61000).toISOString()}));
 const script=`import json,sys\nfrom datetime import datetime\nfrom decimal import Decimal\nsys.path.insert(0,sys.argv[1])\nfrom tariff_engine import EnergyInterval,SessionBillingInput,build_prototype_engine\ne=build_prototype_engine()\nout=[]\nfor c in json.load(sys.stdin):\n rows=tuple(EnergyInterval(datetime.fromisoformat(i['start_at'].replace('Z','+00:00')),datetime.fromisoformat(i['end_at'].replace('Z','+00:00')),Decimal(i['energy_kwh']),i['grid_support_for_ev'],i['high_demand']) for i in c['intervals'])\n b=e.calculate_session(SessionBillingInput(c['session_id'],'SP_ENEL',rows,datetime.fromisoformat(c['charge_completed_at'].replace('Z','+00:00')),datetime.fromisoformat(c['disconnected_at'].replace('Z','+00:00'))))\n out.append([b['customer'],b['internal_settlement_reference']])\nprint(json.dumps(out))`;
 const r=spawnSync(process.env.TARIFF_TEST_PYTHON??'python',['-B','-c',script,path.join(__dirname,'fixtures/tariff-v1')],{input:JSON.stringify(cases),encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);
 const expected=JSON.parse(r.stdout);cases.forEach((c,n)=>{const b=calculateSession(c.session_id,c.intervals,c.charge_completed_at,c.disconnected_at);assert.deepEqual([b.customer,b.internal_settlement_reference],expected[n]);});
});

test('fim exato no snapshot evita minuto adicional por arredondamento DATETIME legado',()=>{
 const l:any={tariff_version:'SP_ENEL_PROTO_V1',phase:'awaiting_disconnect',charge_completed_at:'2026-09-19T12:00:00.900Z',intervals:[]};
 const b=invoice({id:'99',tariffVersion:'SP_ENEL_PROTO_V1',billingSnapshot:l,endTime:new Date('2026-09-19T12:00:00Z'),disconnectedAt:new Date('2026-09-19T12:15:00.900Z')});
 assert.equal(b!.customer.overstay_fee,'0.00');
});
