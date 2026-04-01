import { Prisma } from '@prisma/client';

const TENANT_SCOPED_MODELS = [
  'User',
  'Contact',
  'Conversation',
  'Message',
  'Order',
  'Booking',
  'FollowUpTask',
  'Reminder',
  'AiRun',
  'KnowledgeDocument',
  'ChannelConfig',
] as const;

/**
 * Prisma extension that auto-injects tenantId into queries.
 * Use with caution — only for request-scoped contexts where tenantId is known.
 */
export function withTenantScope(tenantId: string) {
  return Prisma.defineExtension({
    name: 'tenantScope',
    query: {
      $allOperations({ model, args, query }) {
        if (!model || !TENANT_SCOPED_MODELS.includes(model as any)) {
          return query(args);
        }

        const where = (args as any).where ?? {};
        (args as any).where = { ...where, tenantId };

        if ('data' in (args as any) && (args as any).data && typeof (args as any).data === 'object') {
          (args as any).data = { ...(args as any).data, tenantId };
        }

        return query(args);
      },
    },
  });
}
