import 'dotenv/config';
import {loadDemoDataset} from '../src/demo-history-datasets';
import {DemoHistoryImportService} from '../src/demo-history-import.service';
import {PREDIO_SUPPLIED_PACKAGE} from '../src/demo-history-predio';
import {localLegacyIntegrationDatabase} from '../src/local-legacy-integration';
import {PlatformAccessService} from '../src/platform-access.service';
import {PrismaService} from '../src/prisma.service';

type Args={plan:boolean;apply:boolean;dataRoot:string;sourceRevision?:string};

function argumentsOf(argv:string[]):Args{
  const args:Args={plan:false,apply:false,dataRoot:''};
  for(let i=0;i<argv.length;i++){
    const flag=argv[i];
    if(flag==='--plan'||flag==='--apply'){
      if(flag==='--plan')args.plan=true;else args.apply=true;
      continue;
    }
    if(flag==='--data-root'||flag==='--source-revision'){
      const value=argv[++i];
      if(!value||value.startsWith('--'))throw new Error('Argumento sem valor');
      if(flag==='--data-root')args.dataRoot=value;else args.sourceRevision=value;
      continue;
    }
    throw new Error(`Argumento não reconhecido: ${flag}`);
  }
  if(args.plan===args.apply||!args.dataRoot||args.sourceRevision?.length>64)
    throw new Error('Uso: --plan|--apply --data-root CAMINHO [--source-revision SHA]');
  return args;
}

async function main(){
  const args=argumentsOf(process.argv.slice(2));
  const dataset=loadDemoDataset('PREDIO',args.dataRoot); // Checks frozen GIE hashes before opening MySQL.
  const summary={datasetKey:dataset.datasetKey,datasetSha256:dataset.datasetSha256,
    originalSessions:dataset.sessions.length,
    completedSessions:dataset.sessions.filter(session=>session.status==='COMPLETED').length,
    readings:dataset.readings.length,sharedEnergySourceSha256:PREDIO_SUPPLIED_PACKAGE.sourceDemandSha256,
    suppliedPackage:PREDIO_SUPPLIED_PACKAGE};
  if(args.plan){process.stdout.write(`${JSON.stringify({plan:summary},null,2)}\n`);return;}
  let url:URL;
  try{url=new URL(process.env.DATABASE_URL??'');}
  catch{throw new Error('DATABASE_URL da cópia local ausente ou inválida');}
  if(!localLegacyIntegrationDatabase(url)||process.env.GIE_PREDIO_STATION_ID!=='13')
    throw new Error('Importação permitida apenas na cópia auditada 127.0.0.1:3308/emps_integration_test e estação 13');
  const db=new PrismaService();
  await db.$connect();
  try{
    const [identity]=await db.$queryRaw<Array<{databaseName:string;version:string}>>`
      SELECT DATABASE() AS databaseName, VERSION() AS version`;
    if(identity?.databaseName!=='emps_integration_test'||!String(identity.version).startsWith('8.'))
      throw new Error('Identidade MySQL local não confere');
    const station=await db.station.findUnique({where:{id:13},select:{adminId:true,name:true}});
    if(station?.name!=='Prédio Comercial')throw new Error('Estação 13 não foi confirmada como Prédio Comercial');
    const physicalChargers=await db.charger.count({where:{stationId:13}});
    if(physicalChargers!==3)throw new Error('A cópia local do Prédio não possui os três carregadores originais esperados');
    const operationalBefore={sessions:await db.chargingSession.count(),payments:await db.payment.count()};
    if(operationalBefore.sessions!==65||operationalBefore.payments!==61)
      throw new Error('Totais operacionais da cópia divergiram da auditoria antes da importação');
    const owner=await db.user.findUnique({where:{id:station.adminId},
      select:{id:true,email:true,role:true,accountStatus:true}});
    if(!owner||owner.accountStatus!=='ACTIVE')throw new Error('Proprietário antigo da estação 13 indisponível');
    const importer=new DemoHistoryImportService(db,new PlatformAccessService(db));
    const result=await importer.importPredio({sub:String(owner.id),email:owner.email,role:owner.role},13,
      {dataRoot:args.dataRoot,sourceRevision:args.sourceRevision});
    const operationalAfter={sessions:await db.chargingSession.count(),payments:await db.payment.count()};
    if(operationalAfter.sessions!==operationalBefore.sessions||operationalAfter.payments!==operationalBefore.payments)
      throw new Error('Totais operacionais mudaram durante a importação demonstrativa');
    process.stdout.write(`${JSON.stringify({testDatabase:identity.databaseName,physicalChargers,
      operationalPreserved:operationalAfter,summary,import:result},null,2)}\n`);
  }finally{await db.$disconnect();}
}

main().catch(error=>{process.stderr.write(`${error instanceof Error?error.message:'Falha no histórico do Prédio'}\n`);process.exitCode=1;});
