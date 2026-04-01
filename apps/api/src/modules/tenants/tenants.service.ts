import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    return this.prisma.tenant.findUniqueOrThrow({ where: { id } });
  }

  async updateSettings(id: string, settings: Record<string, unknown>) {
    return this.prisma.tenant.update({
      where: { id },
      data: { settings: settings as any },
    });
  }
}
