import 'dotenv/config';
import {PrismaClient} from '@prisma/client';
import * as bcrypt from 'bcrypt';
function localPresentationAccount(email:string){
 if(email!=='visual.local@emps.invalid'||process.env.NODE_ENV!=='development'||
    process.env.EMPS_GIE_PRESENTATION_ACTIONS_ENABLED!=='true'||
    process.env.EMPS_PHYSICAL_COMMANDS_ENABLED!=='false'||
    process.env.EMPS_EXTERNAL_PAYMENT_SIDE_EFFECTS_ENABLED!=='false'||
    process.env.PAYMENT_PROVIDER!=='sandbox'||process.env.HOST!=='127.0.0.1'||
    process.env.OCPP_GATEWAY_URL||process.env.OCPP_GATEWAY_TOKEN)return false;
 try{
  const database=new URL(process.env.DATABASE_URL??'');
  return database.protocol==='mysql:'&&database.hostname==='127.0.0.1'&&
    database.port==='3307'&&database.pathname==='/emps_demo_test';
 }catch{return false;}
}
async function main(){
 const email=process.env.ADMIN_EMAIL?.trim().toLowerCase(),password=process.env.ADMIN_PASSWORD,name=process.env.ADMIN_NAME?.trim();
 if(process.env.NODE_ENV==='production'||!email||!name||!password||password.length<12)throw new Error('Defina ADMIN_EMAIL, ADMIN_NAME e ADMIN_PASSWORD (12+ caracteres), somente desenvolvimento');
 const presentationTools=localPresentationAccount(email);
 const db=new PrismaClient();try{
  const existing=await db.user.findUnique({where:{email}});
  if(existing){
   if(existing.role!=='ADMIN'||!await bcrypt.compare(password,existing.passwordHash))throw new Error('Conta existente não será alterada');
   if(presentationTools&&!existing.presentationTools)await db.user.update({where:{id:existing.id},data:{presentationTools:true}});
   console.log(JSON.stringify({id:existing.id,email,created:false}));return;
  }
  const user=await db.user.create({data:{email,name,passwordHash:await bcrypt.hash(password,12),role:'ADMIN',accountStatus:'ACTIVE',presentationTools}});
  console.log(JSON.stringify({id:user.id,email,created:true}));
 }finally{await db.$disconnect();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
