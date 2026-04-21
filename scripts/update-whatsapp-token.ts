/**
 * One-off script: update WhatsApp ChannelConfig access_token
 * Usage: npx ts-node -e 'require("./scripts/update-whatsapp-token").run()'
 *   or:  DATABASE_URL=... npx ts-node scripts/update-whatsapp-token.ts
 *
 * Token is read from WHATSAPP_ACCESS_TOKEN env var (never hardcoded).
 */
import { PrismaClient } from '@prisma/client';

async function main() {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '1117681411422548';

  if (!accessToken) {
    console.error('ERROR: Set WHATSAPP_ACCESS_TOKEN env var before running.');
    process.exit(1);
  }

  const prisma = new PrismaClient();

  try {
    const result = await prisma.channelConfig.updateMany({
      where: {
        channel: 'WHATSAPP',
        tenantId: 'demo-tenant',
      },
      data: {
        credentials: {
          phone_number_id: phoneNumberId,
          access_token: accessToken,
        },
        isActive: true,
      },
    });

    if (result.count === 0) {
      // No existing record — create one
      await prisma.channelConfig.create({
        data: {
          tenantId: 'demo-tenant',
          channel: 'WHATSAPP',
          isActive: true,
          credentials: {
            phone_number_id: phoneNumberId,
            access_token: accessToken,
          },
          settings: {},
        },
      });
      console.log('Created new WhatsApp ChannelConfig for demo-tenant');
    } else {
      console.log(`Updated ${result.count} WhatsApp ChannelConfig record(s)`);
    }

    // Verify
    const record = await prisma.channelConfig.findFirst({
      where: { channel: 'WHATSAPP', tenantId: 'demo-tenant' },
    });
    console.log('Current ChannelConfig:', {
      id: record?.id,
      isActive: record?.isActive,
      phone_number_id: (record?.credentials as Record<string, unknown>)?.phone_number_id,
      hasAccessToken: !!(record?.credentials as Record<string, unknown>)?.access_token,
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});