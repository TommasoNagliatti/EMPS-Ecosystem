import type { PrismaService } from './prisma.service';
import type { GieV3Service } from './gie-v3.service';
import { localLegacyIntegrationDatabase } from './local-legacy-integration';

export const BUILDING_STATION_ID = 13;
export const SHOPPING_STATION_ID = 39;
export const BUILDING_GIE_STATION_ID = 'Commercial_HighAutonomy_V2';
export const BUILDING_GIE_PROFILE = 'COMMERCIAL';

/** Bind the already running commercial V3 fixture to the audited local building only. */
export async function ensureLocalBuildingGieBinding(
  db: PrismaService,
  v3: Pick<GieV3Service, 'preflightFixture' | 'preflightFixtureDecision'>,
  env: NodeJS.ProcessEnv = process.env,
){
  let url: URL;
  try { url = new URL(env.DATABASE_URL ?? ''); }
  catch { throw new Error('DATABASE_URL da cópia local inválida'); }
  if(!localLegacyIntegrationDatabase(url,env)||
    env.GIE_COMMERCIAL_STATION_ID!==String(SHOPPING_STATION_ID)||
    env.GIE_STATION_ID!==String(SHOPPING_STATION_ID)||
    env.EMPS_LEGACY_LOCAL_OWNER_ID!=='105'||
    env.GIE_V3_SERVICE_URL!=='http://127.0.0.1:8540'||
    (env.GIE_V3_SERVICE_TOKEN?.length??0)<24)
    throw new Error('Vínculo comercial permitido apenas na cópia local 3308 com Shopping 39 preservada');

  const [identity]=await db.$queryRaw<Array<{databaseName:string;version:string}>>`
    SELECT DATABASE() AS databaseName, VERSION() AS version`;
  if(identity?.databaseName!=='emps_integration_test'||!String(identity.version).startsWith('8.'))
    throw new Error('Identidade MySQL da cópia local não confere');

  const health=await v3.preflightFixture(BUILDING_GIE_STATION_ID,'commercial',BUILDING_GIE_STATION_ID);
  if(health.status!=='running'||health.physical_dispatch!==false||!health.generation)
    throw new Error('Worker GIE comercial não confirmou simulação ativa sem despacho físico');
  const worker=await v3.preflightFixtureDecision(BUILDING_GIE_STATION_ID);
  if(worker.generation!==health.generation||worker.capabilities.presentation!==true||
    worker.capabilities.manual_demo!==true||worker.capabilities.physical_dispatch!==false||
    worker.hardware_commands_sent!==false)
    throw new Error('Decisão GIE comercial não confirma apresentação isolada');

  const result=await db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM stations WHERE id IN (${BUILDING_STATION_ID},${SHOPPING_STATION_ID}) FOR UPDATE`;
    const [building,shopping,buildingBinding,shoppingBinding,commercialBinding]=await Promise.all([
      tx.station.findUnique({where:{id:BUILDING_STATION_ID},select:{id:true,name:true,_count:{select:{chargers:true}}}}),
      tx.station.findUnique({where:{id:SHOPPING_STATION_ID},select:{id:true,name:true,adminId:true}}),
      tx.gieStationBinding.findUnique({where:{stationId:BUILDING_STATION_ID}}),
      tx.gieStationBinding.findUnique({where:{stationId:SHOPPING_STATION_ID}}),
      tx.gieStationBinding.findUnique({where:{gieStationId:BUILDING_GIE_STATION_ID}}),
    ]);
    if(!shopping||shopping.adminId!==105||!/shopping\s+frei\s+caneca/i.test(shopping.name)||shoppingBinding)
      throw new Error('Shopping 39 ou seu GIE legado diverge da auditoria');
    if(!building||!['EMPS Demonstração Integrada','Prédio Comercial'].includes(building.name)||
      building._count.chargers!==3)
      throw new Error('Prédio 13 ou seus três carregadores divergem da auditoria');
    if(buildingBinding&&(buildingBinding.gieStationId!==BUILDING_GIE_STATION_ID||
      buildingBinding.profile!==BUILDING_GIE_PROFILE||buildingBinding.origin!=='SIMULATED'))
      throw new Error('Prédio 13 já possui vínculo GIE incompatível');
    if(commercialBinding&&commercialBinding.stationId!==BUILDING_STATION_ID)
      throw new Error('Perfil GIE comercial já está vinculado a outra estação');
    if(Boolean(buildingBinding)!==Boolean(commercialBinding))
      throw new Error('Índices do vínculo GIE comercial divergentes');
    if(!buildingBinding)
      await tx.gieStationBinding.create({data:{stationId:BUILDING_STATION_ID,
        gieStationId:BUILDING_GIE_STATION_ID,profile:BUILDING_GIE_PROFILE,origin:'SIMULATED'}});
    return {stationId:BUILDING_STATION_ID,gieStationId:BUILDING_GIE_STATION_ID,
      profile:BUILDING_GIE_PROFILE,created:!buildingBinding,chargerCount:building._count.chargers};
  },{timeout:15_000});
  return {...result,generation:worker.generation,revision:worker.revision,
    physicalDispatch:false,hardwareCommandsSent:false};
}
