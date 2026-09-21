// Explicit, additive MySQL migration. Run from backend; never called by startup.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=process.cwd();require(path.join(root,'node_modules/dotenv')).config({quiet:true});
const {PrismaClient}=require(path.join(root,'node_modules/@prisma/client'));const db=new PrismaClient();
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const serialize=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?String(v):v);
(async()=>{
 const stamp=new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(3).toString('hex');
 const folder=path.join(root,'../database/backups');fs.mkdirSync(folder,{recursive:true});
 const dump=path.join(folder,`before-tariff-v1-${stamp}.sql`);
 const u=new URL(process.env.DATABASE_URL);if(!['localhost','127.0.0.1'].includes(u.hostname))throw Error('Local MySQL only');
 const docker=[path.join(process.env.ProgramFiles||'C:/Program Files','Docker/Docker/resources/bin/docker.exe'),path.join(process.env.LOCALAPPDATA,'Programs/DockerDesktop/resources/bin/docker.exe')].find(fs.existsSync);if(!docker)throw Error('Docker executable not found');
 const fd=fs.openSync(dump,'wx');
 const result=spawnSync(docker,['exec','-e','MYSQL_PWD='+decodeURIComponent(u.password),'emps-mysql','mysqldump','--no-tablespaces','--single-transaction','--quick','--hex-blob','--set-gtid-purged=OFF','-u',decodeURIComponent(u.username),u.pathname.slice(1)],{windowsHide:true,stdio:['ignore',fd,'pipe']});fs.closeSync(fd);
 if(result.status!==0)throw Error('Dump failed; migration not applied');
 const bytes=fs.readFileSync(dump);if(bytes.length<1000||!bytes.toString().includes('-- Dump completed on'))throw Error('Incomplete dump; migration not applied');
 const tables=(await db.$queryRawUnsafe('SHOW TABLES')).map(r=>Object.values(r)[0]);
 const before={};
 for(const t of tables){if(!/^\w+$/.test(t))throw Error('Invalid table');const cols=(await db.$queryRawUnsafe(`SHOW COLUMNS FROM \`${t}\``)).map(r=>r.Field);const q=`SELECT ${cols.map(c=>'`'+c+'`').join(',')} FROM \`${t}\``;const rows=await db.$queryRawUnsafe(q);before[t]={q,count:rows.length,sha256:hash(serialize(rows.map(serialize).sort()))};}
 const definitions={tariff_version:'VARCHAR(40) NULL',billing_snapshot:'JSON NULL',disconnected_at:'DATETIME(3) NULL'};
 const cols=await db.$queryRawUnsafe("SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='charging_sessions'");
 const expected={tariff_version:'varchar(40)',billing_snapshot:'json',disconnected_at:'datetime(3)'};
 for(const [name,type] of Object.entries(definitions)){const col=cols.find(c=>c.COLUMN_NAME===name);if(col&&(col.COLUMN_TYPE!==expected[name]||col.IS_NULLABLE!=='YES'))throw Error('Existing column differs: '+name);}
 const missing=Object.entries(definitions).filter(([name])=>!cols.some(c=>c.COLUMN_NAME===name));
 const sql=missing.length?'ALTER TABLE charging_sessions '+missing.map(([n,t])=>'ADD COLUMN `'+n+'` '+t).join(', '):null;
 if(sql)await db.$executeRawUnsafe(sql);
 const preservation={};for(const [t,b] of Object.entries(before)){const rows=await db.$queryRawUnsafe(b.q);preservation[t]={count:rows.length,unchanged:b.count===rows.length&&b.sha256===hash(serialize(rows.map(serialize).sort()))};}
 const columns=await db.$queryRawUnsafe("SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='charging_sessions' AND COLUMN_NAME IN ('tariff_version','billing_snapshot','disconnected_at')");
 const populated=await db.$queryRawUnsafe('SELECT COUNT(*) AS n FROM charging_sessions WHERE tariff_version IS NOT NULL OR billing_snapshot IS NOT NULL OR disconnected_at IS NOT NULL');
 const report={at:new Date().toISOString(),backup:dump,backupBytes:bytes.length,backupSha256:hash(bytes),sql,columns,preservation,populatedNewColumns:String(populated[0].n)};
 fs.mkdirSync(path.join(root,'reports'),{recursive:true});fs.writeFileSync(path.join(root,'reports',`migration-tariff-v1-${stamp}.json`),serialize(report));
 if(Object.values(preservation).some(p=>!p.unchanged))throw Error('Data changed during migration: inspect preservation report');
 console.log(serialize(report));
})().catch(e=>{console.error(e instanceof Error?e.message:'Migration failed');process.exitCode=1}).finally(()=>db.$disconnect());
