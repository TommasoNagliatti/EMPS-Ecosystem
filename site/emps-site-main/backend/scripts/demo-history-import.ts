import 'dotenv/config';
import {readFileSync} from 'node:fs';
import {Role} from '@prisma/client';
import {loadDemoDataset, type DemoDatasetKind} from '../src/demo-history-datasets';
import {DemoHistoryImportService, type DemoStationIds} from '../src/demo-history-import.service';
import {type DemoFinancialScenario} from '../src/demo-history-finance';
import {PlatformAccessService} from '../src/platform-access.service';
import {intId} from '../src/persistence';
import {PrismaService} from '../src/prisma.service';
import {remoteDevelopment} from '../src/remote-development';
import {localLegacyIntegrationDatabase} from '../src/local-legacy-integration';

const KINDS=['SHOPPING','POSTO','CASA'] as const;
type Arguments={
  plan:boolean;apply:boolean;dataRoot?:string;ownerId?:string;
  commercialId?:string;postoId?:string;casaId?:string;
  stationId?:string;resetBatch?:string;sourceRevision?:string;scenarioFile?:string;
  commercialChargerMapFile?:string;
};

function usage():never{
  throw new Error('Uso: --plan --data-root CAMINHO | --apply --owner-id ID --commercial-id ID --posto-id ID --casa-id ID --data-root CAMINHO [--scenario-file JSON] [--commercial-charger-map JSON] [--source-revision SHA] | --apply --owner-id ID --station-id ID --reset-batch UUID');
}

function argumentsOf(argv:string[]):Arguments{
  const args:Arguments={plan:false,apply:false};
  const values:Record<string,keyof Arguments>={
    '--data-root':'dataRoot','--owner-id':'ownerId','--commercial-id':'commercialId',
    '--posto-id':'postoId','--casa-id':'casaId','--station-id':'stationId',
    '--reset-batch':'resetBatch','--source-revision':'sourceRevision','--scenario-file':'scenarioFile',
    '--commercial-charger-map':'commercialChargerMapFile',
  };
  for(let i=0;i<argv.length;i++){
    const flag=argv[i];
    if(flag==='--apply'||flag==='--plan'){
      const key=flag==='--apply'?'apply':'plan';
      if(args[key])usage();args[key]=true;continue;
    }
    const key=values[flag];
    if(!key||!argv[i+1]||argv[i+1].startsWith('--')||args[key])usage();
    (args as Record<string,unknown>)[key]=argv[++i];
  }
  if(args.plan===args.apply)usage();
  if(args.plan&&(!args.dataRoot||args.ownerId||args.resetBatch||args.commercialChargerMapFile))usage();
  if(args.apply&&(!args.ownerId||(args.resetBatch?(!args.stationId||args.dataRoot):
    (!args.dataRoot||!args.commercialId||!args.postoId||!args.casaId))))usage();
  if(args.resetBatch&&(args.scenarioFile||args.commercialChargerMapFile||args.sourceRevision))usage();
  return args;
}

function assertDisposableMysql(){
  if(process.env.NODE_ENV==='production'||remoteDevelopment())
    throw new Error('Importação demonstrativa permitida somente em MySQL local descartável');
  let url:URL;
  try{url=new URL(process.env.DATABASE_URL??'');}catch{throw new Error('DATABASE_URL de teste ausente ou inválida');}
  const database=decodeURIComponent(url.pathname.slice(1));
  const disposableDemo=url.protocol==='mysql:'&&['127.0.0.1','localhost'].includes(url.hostname)&&
    /^[1-9][0-9]{0,4}$/.test(url.port)&&!!url.username&&url.username.toLowerCase()!=='root'&&
    /^emps_demo_test(?:_[a-z0-9_]+)?$/.test(database)&&
    process.env.DEMO_HISTORY_TEST_DATABASE===database;
  if(!disposableDemo&&!localLegacyIntegrationDatabase(url))
    throw new Error('DATABASE_URL deve apontar para MySQL demonstrativo descartável ou para a cópia local de integração confirmada');
  return database;
}

function scenariosFrom(file:string|undefined){
  if(!file)return undefined;
  const parsed=JSON.parse(readFileSync(file,'utf8')) as Partial<Record<DemoDatasetKind,DemoFinancialScenario>>;
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||
    Object.keys(parsed).some(key=>!KINDS.includes(key as DemoDatasetKind)))
    throw new Error('Arquivo de cenários deve conter somente SHOPPING, POSTO e CASA');
  return parsed;
}

function commercialChargerMapFrom(file:string|undefined):Record<string,string|number>|undefined{
  if(!file)return undefined;
  const parsed=JSON.parse(readFileSync(file,'utf8')) as unknown;
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||
    Object.values(parsed).some(value=>typeof value!=='string'&&typeof value!=='number'))
    throw new Error('Mapa comercial deve ser um objeto JSON de IDs históricos para IDs EMPS');
  return parsed as Record<string,string|number>;
}

async function main(){
  const args=argumentsOf(process.argv.slice(2));
  if(args.plan){
    const preview=KINDS.map(kind=>{
      const dataset=loadDemoDataset(kind,args.dataRoot!);
      return {kind,datasetKey:dataset.datasetKey,datasetSha256:dataset.datasetSha256,
        sourceStartedAt:dataset.sourceStartedAt,sourceEndedAt:dataset.sourceEndedAt,
        sessions:dataset.sessions.length,readings:dataset.readings.length,sourceFiles:dataset.sourceFiles};
    });
    process.stdout.write(`${JSON.stringify(preview,null,2)}\n`);
    return;
  }
  const expectedDatabase=assertDisposableMysql();
  const legacyClone=localLegacyIntegrationDatabase(new URL(process.env.DATABASE_URL!));
  if(legacyClone&&(args.ownerId!=='105'||process.env.GIE_COMMERCIAL_STATION_ID!=='39'||
      (!args.resetBatch&&args.commercialId!=='39')))
    throw new Error('A cópia local auditada exige proprietário 105 e Shopping 39');
  const db=new PrismaService();
  await db.$connect();
  try{
    const [identity]=await db.$queryRaw<Array<{databaseName:string;version:string}>>`SELECT DATABASE() AS databaseName, VERSION() AS version`;
    if(identity?.databaseName!==expectedDatabase||!String(identity.version).startsWith('8.'))
      throw new Error('Identidade MySQL de teste não confere');
    const owner=await db.user.findUnique({where:{id:intId(args.ownerId!)},
      select:{id:true,email:true,role:true,accountStatus:true}});
    if(!owner||owner.accountStatus!=='ACTIVE'||(!legacyClone&&owner.role!==Role.ADMIN))
      throw new Error('Conta proprietária ativa e autorizada não encontrada no banco de teste');
    if(legacyClone){
      const shopping=await db.station.findUnique({where:{id:39},select:{adminId:true,name:true}});
      if(!shopping||shopping.adminId!==105||!/shopping\s+frei\s+caneca/i.test(shopping.name))
        throw new Error('Proprietário da Shopping na cópia local não corresponde à auditoria');
    }
    const user={sub:String(owner.id),email:owner.email,role:owner.role};
    const importer=new DemoHistoryImportService(db,new PlatformAccessService(db));
    if(args.resetBatch){
      const result=await importer.resetBatch(user,args.stationId!,args.resetBatch);
      process.stdout.write(`${JSON.stringify({testDatabase:expectedDatabase,reset:result},null,2)}\n`);
      return;
    }
    const stations:DemoStationIds={SHOPPING:args.commercialId!,POSTO:args.postoId!,CASA:args.casaId!};
    const result=await importer.importAll(user,stations,{dataRoot:args.dataRoot!,
      sourceRevision:args.sourceRevision,scenarios:scenariosFrom(args.scenarioFile),
      commercialChargerMap:commercialChargerMapFrom(args.commercialChargerMapFile)});
    process.stdout.write(`${JSON.stringify({testDatabase:expectedDatabase,imports:result},null,2)}\n`);
  }finally{await db.$disconnect();}
}

main().catch(error=>{process.stderr.write(`${error instanceof Error?error.message:'Falha na importação demonstrativa'}\n`);process.exitCode=1;});
