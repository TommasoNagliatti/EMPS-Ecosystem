// Read-only rollout evidence; never prints private configuration.
require('dotenv/config');
const {PrismaClient}=require('@prisma/client'),{readFileSync,writeFileSync,existsSync}=require('node:fs'),{createHash}=require('node:crypto'),{execFileSync}=require('node:child_process'),path=require('node:path'),assert=require('node:assert/strict');
const db=new PrismaClient(),hash=b=>createHash('sha256').update(b).digest('hex');
(async()=>{
 const migration=JSON.parse(readFileSync('reports/migration-tariff-v1-2026-09-19T18-43-01-033Z-ebc4c2.json'));
 assert.equal(hash(readFileSync(migration.backup)),migration.backupSha256);
 const columns=await db.$queryRawUnsafe('DESCRIBE charging_sessions'),wanted=columns.filter(c=>['tariff_version','billing_snapshot','disconnected_at'].includes(c.Field));
 assert.equal(wanted.length,3);assert.ok(wanted.every(c=>c.Null==='YES'));assert.equal(wanted.find(c=>c.Field==='billing_snapshot').Type,'json');
 const official=readFileSync('../database/EMPS_Database_Completo.sql','utf8'),prisma=readFileSync('prisma/schema.prisma','utf8');
 for(const name of ['tariff_version','billing_snapshot','disconnected_at']){assert.ok(official.includes(name));assert.ok(prisma.includes(name));}
 const legacyCount=await db.chargingSession.count({where:{tariffVersion:null,billingSnapshot:{equals:require('@prisma/client').Prisma.DbNull},disconnectedAt:null}});assert.equal(legacyCount,23);
 const rows=await db.chargingSession.findMany({where:{id:{in:[64n,65n,66n,67n,68n]}},include:{payments:true}});
 const visual=rows.find(s=>s.id===68n),bill=visual.billingSnapshot.breakdown.customer;
 assert.equal(visual.status,'FINISHED');assert.equal(bill.energy_kwh,'0.8337');assert.equal(bill.total_amount,'1.74');assert.equal(bill.effective_energy_rate_per_kwh,'2.09');assert.equal(String(visual.payments[0].amount),'1.74');
 const root=path.resolve('../../..'),gie=path.join(root,'gie/GIE'),manifest=JSON.parse(readFileSync(path.join(gie,'docs/release/frozen_manifest.json'))),mismatches=[];
 for(const [file,expected] of Object.entries(manifest)){const f=path.join(gie,file);if(existsSync(f)){const actual=hash(readFileSync(f));if(actual!==expected)mismatches.push({file,expected,actual});}else mismatches.push({file,missing:true});}
 const repos={site:path.resolve('..'),app:path.join(root,'app/emps-charge'),gie};const files={};const findings=[];
 const cfg=require('dotenv').parse(readFileSync('.env.presentation'));const secrets=Object.entries(cfg).filter(([k,v])=>/PASSWORD|SECRET|TOKEN/.test(k)&&v.length>=16).map(([,v])=>v);
 for(const [name,cwd] of Object.entries(repos)){
  const changed=execFileSync('git',['diff','--name-only'],{cwd,encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean),untracked=execFileSync('git',['ls-files','--others','--exclude-standard'],{cwd,encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);files[name]={changed,new:untracked};
  for(const file of [...changed,...untracked]){
   if(file==='database/emps_db_atual_para_equipe_2026-09-17.sql'||/\.(pdf|png|jpg)$/.test(file))continue;
   const f=path.join(cwd,file);if(!existsSync(f))continue;const text=readFileSync(f,'utf8');
   if(/(?:sk|rk)_(?:test|live)_[A-Za-z0-9]{30,}|whsec_[A-Za-z0-9]{24,}/.test(text)||secrets.some(secret=>text.includes(secret)))findings.push(name+'/'+file);
  }
 }
 assert.deepEqual(findings,[]);
 const result={at:new Date().toISOString(),mysqlConnected:true,backupVerified:true,columns:wanted,prismaAndOfficialSQLContainColumns:true,legacySessionsWithoutBackfill:legacyCount,visualCash:{sessionId:'68',...bill,paymentAmount:String(visual.payments[0].amount),status:visual.status},sessions:rows.map(s=>({id:String(s.id),status:s.status,tariffVersion:s.tariffVersion,energy:String(s.energyKwh),total:String(s.totalPrice),endedAt:s.endTime,disconnectedAt:s.disconnectedAt,payments:s.payments.map(p=>({provider:p.provider,status:p.status,amount:String(p.amount),received:String(p.amountReceived)}))})),frozenMismatches:mismatches,privateConfigIgnored:execFileSync('git',['check-ignore','.env','.env.presentation'],{encoding:'utf8'}).trim().split(/\r?\n/),secretScan:{findings,scope:'Changed/untracked source and text reports; pre-existing private handoff SQL excluded'},files};
 writeFileSync('reports/rollout-final-evidence.json',JSON.stringify(result,null,2));console.log(JSON.stringify({passed:true,legacyCount,frozenMismatches:mismatches.map(m=>m.file),secretsFound:findings.length,visualCash:result.visualCash}));
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.$disconnect());
