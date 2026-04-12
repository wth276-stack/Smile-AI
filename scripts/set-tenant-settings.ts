/**
 * One-time / dev script: seed first tenant AI settings + clinic test tenant + KB.
 *
 * Run from repo root (DATABASE_URL in .env):
 *   pnpm set-tenant-settings
 *   npx ts-node --project tsconfig.scripts.json scripts/set-tenant-settings.ts
 *
 * Prisma client is generated in packages/database (`pnpm db:generate`).
 */
import { resolve } from 'path';
import { config } from 'dotenv';

// Load .env from repo root when cwd is elsewhere
config({ path: resolve(__dirname, '../.env') });

import { DocType } from '@prisma/client';
import { prisma } from '../packages/database/src/client';

const BEAUTY_SETTINGS = {
  businessName: '美容療程示範店',
  businessType: 'beauty and wellness salon',
  assistantRole: '親切、專業、不硬銷；以療程效果與皮膚需求為中心',
  language: '粵語為主，可切換英文',
} as const;

const CLINIC_TENANT_ID = 'clinic-demo-tenant';

const CLINIC_SETTINGS = {
  businessName: '康健家庭醫學診所',
  businessType: 'medical clinic',
  assistantRole: '專業、清晰、不作診斷；協助預約與一般資訊',
  language: '粵語為主，可切換英文',
} as const;

const CLINIC_SERVICES: Array<{
  id: string;
  title: string;
  duration: string;
  price: string;
  content: string;
  aliases: string[];
}> = [
  {
    id: 'svc-clinic-gp',
    title: '普通科門診',
    duration: '30 分鐘',
    price: 'HK$350',
    aliases: ['普通科', '門診', '睇醫生', 'GP'],
    content:
      '普通科門診由家庭醫生應診，處理一般常見病症、慢性病跟進及轉介需要。請先致電或 WhatsApp 預約時段。',
  },
  {
    id: 'svc-clinic-healthcheck',
    title: '身體檢查計劃',
    duration: '60 分鐘',
    price: 'HK$1,200',
    aliases: ['身體檢查', '體檢', '健康檢查'],
    content:
      '基礎身體檢查計劃包括問診、基本體格檢查及報告講解。詳細檢查項目以診所當日提供為準，建議預約前先查詢。',
  },
  {
    id: 'svc-clinic-flu',
    title: '流感疫苗接種',
    duration: '15 分鐘',
    price: 'HK$250',
    aliases: ['流感針', '疫苗', '防疫針'],
    content:
      '季節性流感疫苗接種服務。接種前請告知醫護人員過敏史及正在服用的藥物；接種後請留院觀察約 15 分鐘。',
  },
];

async function main() {
  const first = await prisma.tenant.findFirst({
    orderBy: { createdAt: 'asc' },
  });

  if (!first) {
    console.error('No tenant found in database.');
    process.exit(1);
  }

  const updatedFirst = await prisma.tenant.update({
    where: { id: first.id },
    data: { settings: BEAUTY_SETTINGS as object },
  });

  console.log('--- First tenant (settings updated) ---');
  console.log(JSON.stringify(updatedFirst, null, 2));

  const clinic = await prisma.tenant.upsert({
    where: { id: CLINIC_TENANT_ID },
    create: {
      id: CLINIC_TENANT_ID,
      name: '康健家庭醫學診所',
      plan: 'STARTER',
      settings: CLINIC_SETTINGS as object,
    },
    update: {
      name: '康健家庭醫學診所',
      plan: 'STARTER',
      settings: CLINIC_SETTINGS as object,
    },
  });

  console.log('\n--- Clinic test tenant ---');
  console.log(JSON.stringify(clinic, null, 2));

  for (const svc of CLINIC_SERVICES) {
    await prisma.knowledgeDocument.upsert({
      where: { id: svc.id },
      create: {
        id: svc.id,
        tenantId: CLINIC_TENANT_ID,
        title: svc.title,
        docType: DocType.SERVICE,
        content: svc.content,
        duration: svc.duration,
        price: svc.price,
        aliases: svc.aliases,
        isActive: true,
      },
      update: {
        title: svc.title,
        docType: DocType.SERVICE,
        content: svc.content,
        duration: svc.duration,
        price: svc.price,
        aliases: svc.aliases,
        isActive: true,
      },
    });
    console.log(`✅ KB: ${svc.title}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
