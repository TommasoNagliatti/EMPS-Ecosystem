import { intId } from "./persistence";
import { BadRequestException, Body, ConflictException, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { AuthRequest, JwtGuard, Roles, RolesGuard } from "./auth";
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { CreateAdminDto } from './dtos';
import { PrismaService } from "./prisma.service";

@UseGuards(JwtGuard)
@Controller("users")
export class UsersController {
  constructor(private prisma: PrismaService) {}
  @Post('admins')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  async createAdmin(@Body() dto: CreateAdminDto) {
    if (Buffer.byteLength(dto.password, 'utf8') > 72) throw new BadRequestException('Senha excede 72 bytes.');
    try {
      return await this.prisma.user.create({data:{name:dto.name.trim(),email:dto.email.trim().toLowerCase(),passwordHash:await bcrypt.hash(dto.password,12),role:Role.ADMIN,accountStatus:'ACTIVE'},select:{id:true,name:true,email:true,role:true,accountStatus:true}});
    } catch (error) {
      if(error instanceof Prisma.PrismaClientKnownRequestError && error.code==='P2002') throw new ConflictException('E-mail já cadastrado.');
      throw error;
    }
  }
  @Get("me")
  me(@Req() request: AuthRequest) {
    return this.prisma.user.findUnique({
      where: { id: intId(request.user.sub) },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });
  }
}
