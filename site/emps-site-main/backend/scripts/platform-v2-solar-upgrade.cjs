// Controlled local follow-up: fresh dump, then one additive DDL. Never resets data.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
process.loadEnvFile('.env');
const {PrismaClient}=require('@prisma/client');
const db=new PrismaClient();
(async()=>{
 const existing=await db.$queryRaw`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='station_solar_assets' AND COLUMN_NAME='status'`;
 if(existing.length){console.log('Solar status already applied');return;}
 const dir=path.join('C:/goodwill_ai','emps-v2-private-'+new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(dir);
 const file=path.join(dir,'before-solar-status.sql'),fd=fs.openSync(file,'wx');
 const docker=[path.join(process.env.ProgramFiles,'Docker/Docker/resources/bin/docker.exe'),path.join(process.env.LOCALAPPDATA,'Programs/DockerDesktop/resources/bin/docker.exe')].find(fs.existsSync);
 if(!docker)throw Error('Docker CLI unavailable');
 const dump=cp.spawnSync(docker,['exec','emps-mysql','sh','-c','MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --routines --triggers --events --hex-blob --no-tablespaces --set-gtid-purged=OFF emps_db'],{stdio:['ignore',fd,'pipe']});fs.closeSync(fd);
 if(dump.status!==0 || !fs.readFileSync(file,'utf8').includes('Dump completed'))throw Error('Dump did not complete; no migration applied');
 const sha256=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 await db.$executeRawUnsafe("ALTER TABLE station_solar_assets ADD COLUMN status VARCHAR(30) NOT NULL DEFAULT 'CONFIGURED'");
 console.log(JSON.stringify({backup:file,sha256,migration:'20260929_platform_v2_solar_status',applied:true}));
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>db.$disconnect());
