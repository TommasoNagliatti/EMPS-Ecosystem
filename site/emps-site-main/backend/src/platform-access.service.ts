import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StaffRole } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { intId } from './persistence';
import type { AuthUser } from './auth';

export type StationPermission = 'READ' | 'OPERATE' | 'MANAGE' | 'OWNER';
export const stationRoles: Record<StationPermission, StaffRole[]> = {
  READ: ['OWNER', 'MANAGER', 'OPERATOR', 'COLLECTOR', 'VIEWER'],
  OPERATE: ['OWNER', 'MANAGER', 'OPERATOR', 'COLLECTOR'],
  MANAGE: ['OWNER', 'MANAGER'],
  OWNER: ['OWNER'],
};

@Injectable()
export class PlatformAccessService {
  constructor(private readonly db: PrismaService) {}
  async require(user: Pick<AuthUser, 'sub'>, stationId: string | number, permission: StationPermission = 'READ', tx: Prisma.TransactionClient = this.db) {
    const id = intId(stationId), userId = intId(user.sub);
    const station = await tx.station.findUnique({where: {id}, include: {staff: {where: {userId}}}});
    if (!station) throw new NotFoundException('Estação não encontrada');
    const role = station.adminId === userId ? 'OWNER' : station.staff[0]?.staffRole;
    if (!role || !stationRoles[permission].includes(role)) throw new ForbiddenException('Sem permissão nesta estação');
    return {...station, membershipRole: role};
  }
  async reviewer(user: Pick<AuthUser, 'sub'>) {
    const account = await this.db.user.findUnique({where: {id: intId(user.sub)}, select: {platformReviewer: true}});
    if (!account?.platformReviewer) throw new ForbiddenException('Revisão restrita à equipe autorizada');
  }
  async presentation(user: Pick<AuthUser, 'sub'>) {
    const account = await this.db.user.findUnique({where: {id: intId(user.sub)}, select: {presentationTools: true}});
    if (!account?.presentationTools) throw new ForbiddenException('Ferramentas de apresentação restritas');
  }
}
