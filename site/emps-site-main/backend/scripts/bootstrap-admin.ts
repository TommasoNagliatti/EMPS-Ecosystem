import 'dotenv/config';
import {PrismaClient} from '@prisma/client';
import * as bcrypt from 'bcrypt';
async function main(){
 const email=process.env.ADMIN_EMAIL?.trim().toLowerCase(),password=process.env.ADMIN_PASSWORD,name=process.env.ADMIN_NAME?.trim();
 if(process.env.NODE_ENV==='production'||!email||!name||!password||password.length<12)throw new Error('Defina ADMIN_EMAIL, ADMIN_NAME e ADMIN_PASSWORD (12+ caracteres), somente desenvolvimento');
 const db=new PrismaClient();try{
  const existing=await db.user.findUnique({where:{email}});
  if(existing){if(existing.role!=='ADMIN'||!await bcrypt.compare(password,existing.passwordHash))throw new Error('Conta existente não será alterada');console.log(JSON.stringify({id:existing.id,email,created:false}));return;}
  const user=await db.user.create({data:{email,name,passwordHash:await bcrypt.hash(password,12),role:'ADMIN',accountStatus:'ACTIVE'}});
  console.log(JSON.stringify({id:user.id,email,created:true}));
 }finally{await db.$disconnect();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
