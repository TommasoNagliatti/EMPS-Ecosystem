import 'dotenv/config';
import {ensureLocalBuildingGieBinding} from '../src/gie-local-commercial-binding';
import {GieV3Service} from '../src/gie-v3.service';
import {PlatformAccessService} from '../src/platform-access.service';
import {PrismaService} from '../src/prisma.service';
import {RealtimeService} from '../src/realtime.service';

async function main(){
  const db=new PrismaService();
  await db.$connect();
  try{
    const v3=new GieV3Service(db,new PlatformAccessService(db),new RealtimeService(db));
    const result=await ensureLocalBuildingGieBinding(db,v3);
    console.log(JSON.stringify(result));
  }finally{await db.$disconnect();}
}

main().catch(error=>{
  console.error(error instanceof Error?error.message:'Vínculo GIE comercial local falhou');
  process.exitCode=1;
});
