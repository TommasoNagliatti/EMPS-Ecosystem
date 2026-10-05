import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PlatformAccessService } from './platform-access.service';
import type { AuthUser } from './auth';
import { createOpaqueToken, hashOpaqueToken, normalizeEmail } from './mobile.utils';
import { MemberDto, MemberRoleDto } from './platform.dtos';
import { NotificationGateway } from './notification.gateway';
import { intId } from './persistence';

@Injectable()
export class StationMembersService {
  constructor(private db:PrismaService,private access:PlatformAccessService,private notifications:NotificationGateway){}
  async list(user:AuthUser,id:string){
    const s=await this.access.require(user,id,'MANAGE');
    return {ownerId:s.adminId,members:await this.db.stationStaff.findMany({where:{stationId:s.id},select:{userId:true,staffRole:true,assignedAt:true,user:{select:{name:true,email:true}}}}),invites:await this.db.stationInvite.findMany({where:{stationId:s.id},select:{id:true,email:true,role:true,invitedBy:true,expiresAt:true,acceptedAt:true,revokedAt:true}})};
  }
  async invite(user:AuthUser,id:string,dto:MemberDto){
    const token=createOpaqueToken(),email=normalizeEmail(dto.email);
    const result=await this.db.$transaction(async tx=>{
      const s=await this.access.require(user,id,'OWNER',tx);
      const target=await tx.user.findUnique({where:{email},select:{id:true}});
      if(target?.id===s.adminId)throw new BadRequestException('Proprietário já vinculado');
      if(target){
        if(await tx.stationStaff.findUnique({where:{stationId_userId:{stationId:s.id,userId:target.id}}}))throw new ConflictException('Pessoa já pertence à equipe');
        await tx.stationStaff.create({data:{stationId:s.id,userId:target.id,staffRole:dto.role}});
      }else{
        await tx.stationInvite.updateMany({where:{stationId:s.id,email,acceptedAt:null,revokedAt:null},data:{revokedAt:new Date()}});
        await tx.stationInvite.create({data:{stationId:s.id,email,role:dto.role,tokenHash:hashOpaqueToken(token),invitedBy:intId(user.sub),expiresAt:new Date(Date.now()+7*86400000)}});
      }
      await tx.stationAuditEvent.create({data:{stationId:s.id,actorId:intId(user.sub),action:target?'member.added':'member.invited',details:{email,role:dto.role}}});
      return {linked:!!target,stationId:s.id};
    });
    if(!result.linked)await this.notifications.send('station-invite',{email,stationId:result.stationId,token,expiresInDays:7});
    return {...result,...(!result.linked?{invitationToken:token,delivery:'LOCAL_OUTBOX'}:{})};
  }
  async accept(user:AuthUser,token:string){
    return this.db.$transaction(async tx=>{
      const invite=await tx.stationInvite.findUnique({where:{tokenHash:hashOpaqueToken(token)}});
      if(!invite||invite.revokedAt||invite.acceptedAt||invite.expiresAt<=new Date()||invite.email!==normalizeEmail(user.email))throw new NotFoundException('Convite inválido ou expirado para esta conta');
      const claim=await tx.stationInvite.updateMany({where:{id:invite.id,acceptedAt:null,revokedAt:null,expiresAt:{gt:new Date()}},data:{acceptedAt:new Date()}});
      if(claim.count!==1)throw new ConflictException('Convite já utilizado');
      await tx.stationStaff.upsert({where:{stationId_userId:{stationId:invite.stationId,userId:intId(user.sub)}},create:{stationId:invite.stationId,userId:intId(user.sub),staffRole:invite.role},update:{}});
      await tx.stationAuditEvent.create({data:{stationId:invite.stationId,actorId:intId(user.sub),action:'invite.accepted',details:{inviteId:invite.id}}});
      return {stationId:invite.stationId};
    });
  }
  async change(user:AuthUser,id:string,memberId:string,dto:MemberRoleDto|null){
    return this.db.$transaction(async tx=>{
      const s=await this.access.require(user,id,'OWNER',tx),userId=intId(memberId);
      if(userId===s.adminId)throw new BadRequestException('Não é permitido remover ou transferir o proprietário por este fluxo');
      const where={stationId_userId:{stationId:s.id,userId}};
      if(!await tx.stationStaff.findUnique({where}))throw new NotFoundException('Membro não encontrado');
      if(dto)await tx.stationStaff.update({where,data:{staffRole:dto.role}});else await tx.stationStaff.delete({where});
      await tx.stationAuditEvent.create({data:{stationId:s.id,actorId:intId(user.sub),action:dto?'member.role_changed':'member.removed',details:{userId,role:dto?.role??null}}});
      return {ok:true};
    });
  }
}
