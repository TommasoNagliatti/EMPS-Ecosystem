import { intId } from "./persistence";
import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { AuthRequest, JwtGuard } from "./auth";
import { PrismaService } from "./prisma.service";

@UseGuards(JwtGuard)
@Controller("users")
export class UsersController {
  constructor(private prisma: PrismaService) {}
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
