import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats(tenantId: string) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [
      totalConversations,
      todayConversations,
      totalContacts,
      todayContacts,
      pendingBookings,
      todayBookings,
      knowledgeDocs,
    ] = await Promise.all([
      this.prisma.conversation.count({ where: { tenantId } }),
      this.prisma.conversation.count({ where: { tenantId, createdAt: { gte: todayStart } } }),
      this.prisma.contact.count({ where: { tenantId } }),
      this.prisma.contact.count({ where: { tenantId, createdAt: { gte: todayStart } } }),
      this.prisma.booking.count({ where: { tenantId, status: 'PENDING' } }),
      this.prisma.booking.count({ where: { tenantId, startTime: { gte: todayStart } } }),
      this.prisma.knowledgeDocument.count({ where: { tenantId, isActive: true } }),
    ]);

    return {
      conversations: { total: totalConversations, today: todayConversations },
      contacts: { total: totalContacts, today: todayContacts },
      bookings: { pending: pendingBookings, today: todayBookings },
      knowledgeDocs,
    };
  }
}
