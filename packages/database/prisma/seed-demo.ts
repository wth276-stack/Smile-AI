import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import {
  DEMO_TENANT_CANONICAL_SLOT_SETTINGS,
  DEMO_TENANT_ID,
  mergeDemoTenantSettingsPreservingKeys,
  tenantJsonMissingStructuredBusinessHours,
} from '../src/demo-tenant-slot-settings';
import { applyIndustrySeedToTenant } from '../src/apply-industry-seed';
import { INDUSTRY_ID_TO_DEMO_TENANT_ID } from '../src/demo-industry-tenants';

const prisma = new PrismaClient();

const DEMO_USER_EMAIL = 'demo@example.com';
const DEMO_USER_PASSWORD = 'demo123456';

async function main() {
  console.log('🌱 Seeding demo tenant...');

  const existingTenant = await prisma.tenant.findUnique({ where: { id: DEMO_TENANT_ID } });
  const existingSettings = (existingTenant?.settings as Record<string, unknown>) ?? {};
  const mergedSettings = tenantJsonMissingStructuredBusinessHours(existingSettings)
    ? mergeDemoTenantSettingsPreservingKeys(existingSettings, { ...DEMO_TENANT_CANONICAL_SLOT_SETTINGS })
    : existingSettings;

  // Create or update demo tenant shell (name/KB overwritten by industry seed below)
  const tenant = await prisma.tenant.upsert({
    where: { id: DEMO_TENANT_ID },
    update: { name: '美容療程示範店', settings: mergedSettings },
    create: {
      id: DEMO_TENANT_ID,
      name: '美容療程示範店',
      plan: 'GROWTH',
      settings: { ...DEMO_TENANT_CANONICAL_SLOT_SETTINGS },
    },
  });

  console.log(`✅ Tenant: ${tenant.name} (${tenant.id})`);

  // Canonical beauty content: packages/database/src/industry-seeds.ts (do not duplicate long-form KB here)
  const beautyApply = await applyIndustrySeedToTenant(prisma, DEMO_TENANT_ID, 'beauty');
  console.log(
    `✅ Beauty industry seed (canonical): ${beautyApply.displayName}, ${beautyApply.kbCount} KB documents`,
  );

  // Create demo user for login
  const passwordHash = await bcrypt.hash(DEMO_USER_PASSWORD, 12);
  const user = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: DEMO_TENANT_ID, email: DEMO_USER_EMAIL } },
    update: {
      passwordHash,
      name: 'Demo Admin',
      role: UserRole.OWNER,
    },
    create: {
      tenantId: DEMO_TENANT_ID,
      email: DEMO_USER_EMAIL,
      passwordHash,
      name: 'Demo Admin',
      role: UserRole.OWNER,
    },
  });
  console.log(`✅ User: ${user.email} (password: ${DEMO_USER_PASSWORD})`);

  // Create a demo contact for conversations
  const contact = await prisma.contact.upsert({
    where: { id: 'demo-contact' },
    update: {
      name: 'Demo Customer',
      phone: '+85291234567',
    },
    create: {
      id: 'demo-contact',
      tenantId: DEMO_TENANT_ID,
      name: 'Demo Customer',
      phone: '+85291234567',
      externalIds: { webchat: 'demo-contact' },
    },
  });
  console.log(`✅ Contact: ${contact.name}`);

  const extraDemoTenants = Object.entries(INDUSTRY_ID_TO_DEMO_TENANT_ID).filter(
    ([, tid]) => tid !== DEMO_TENANT_ID,
  );
  for (const [, tid] of extraDemoTenants) {
    await prisma.tenant.upsert({
      where: { id: tid },
      update: {},
      create: {
        id: tid,
        name: tid,
        plan: 'GROWTH',
        settings: {},
      },
    });
    console.log(`✅ Demo tenant row: ${tid}`);
  }
  for (const [industryId, tid] of extraDemoTenants) {
    const { displayName, kbCount } = await applyIndustrySeedToTenant(prisma, tid, industryId);
    console.log(`✅ Industry seed applied: ${industryId} → ${tid} (${displayName}, ${kbCount} docs)`);
  }

  console.log('\n🎉 Demo data seeded successfully!');
  console.log('\n📝 Login credentials:');
  console.log(`   Email: ${DEMO_USER_EMAIL}`);
  console.log(`   Password: ${DEMO_USER_PASSWORD}`);
  console.log(`   Tenant ID: ${DEMO_TENANT_ID}`);
  console.log('\n🌐 URLs:');
  console.log('   Demo Chat: http://localhost:3000/demo/chat');
  console.log('   Login: http://localhost:3000/login');
  console.log('   Dashboard: http://localhost:3000/dashboard');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
