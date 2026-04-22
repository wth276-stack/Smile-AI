import { PrismaClient, DocType, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import {
  DEMO_TENANT_CANONICAL_SLOT_SETTINGS,
  DEMO_TENANT_ID,
  mergeDemoTenantSettingsPreservingKeys,
  tenantJsonMissingStructuredBusinessHours,
} from '../src/demo-tenant-slot-settings';

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

  // Create or update demo tenant
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

  // Create sample services
  const services = [
    {
      id: 'svc-hifu',
      title: 'HIFU 緊緻療程',
      docType: DocType.SERVICE,
      aliases: ['HIFU', '超聲波刀', '緊緻療程', '提升輪廓', 'HIFU瘦面'],
      effect: '緊緻肌膚、提升輪廓、減淡皺紋、改善雙下巴',
      suitable: '面部鬆弛者、想要V臉效果的人士、想改善法令紋的人',
      unsuitable: '孕婦、心臟病患者、皮膚發炎者、有植入物者',
      precaution: '術後一週內避免做臉、避免日曬、保濕要做好',
      duration: '60-90 分鐘',
      price: 'HK$6980',
      discountPrice: 'HK$4980',
      content: `HIFU（High-Intensity Focused Ultrasound）利用高強度聚焦超聲波能量，深入真皮層及筋膜層，刺激膠原蛋白增生，達到緊緻提升效果。

療程特點：
- 非侵入性，無需開刀
- 效果可維持 1-2 年
- 適合面部及頸部

建議療程次數：每年 1-2 次`,
      faqItems: [
        { question: 'HIFU 會痛嗎？', answer: '過程可能有輕微痠痛感，但一般都可以接受。' },
        { question: '幾耐見效？', answer: '一般 2-3 個月後效果最明顯，可維持 1-2 年。' },
        { question: '做幾多次先有效？', answer: '通常一次就有明顯效果，建議每年做 1-2 次維持。' },
      ],
    },
    {
      id: 'svc-facial',
      title: '深層清潔 Facial',
      docType: DocType.SERVICE,
      aliases: ['facial', '清潔facial', '深層清潔', '潔面療程', '洗面'],
      effect: '深層清潔毛孔、去除黑頭粉刺、改善膚色暗沉',
      suitable: '油性肌膚、混合性肌膚、毛孔粗大者',
      unsuitable: '嚴重敏感肌、正在使用A酸者',
      precaution: '術後 24 小時內避免化妝、做好保濕防曬',
      duration: '60 分鐘',
      price: 'HK$480',
      discountPrice: 'HK$298',
      content: `專業深層清潔 Facial 包含：
1. 卸妝潔面
2. 角質軟化
3. 針清黑頭粉刺
4. 收斂毛孔
5. 保濕面膜
6. 護膚品塗抹

適合定期保養，建議每 3-4 週做一次。`,
      faqItems: [
        { question: '做完會唔會即時紅？', answer: '部分人士做完後可能有輕微泛紅，屬正常現象，一般 2-4 小時內消退。' },
        { question: '幾耐做一次好？', answer: '建議每 3-4 週做一次，配合皮膚新陳代謝週期。' },
        { question: '做完可以即日化妝嗎？', answer: '建議療程後 24 小時後再化妝，讓毛孔充分收縮。' },
        { question: '試做價同正價有咩分別？', answer: '療程內容完全一樣，試做價係新客戶優惠，每位限用一次。' },
      ],
    },
    {
      id: 'svc-ipl',
      title: 'IPL 彩光嫩膚',
      docType: DocType.SERVICE,
      aliases: ['IPL', '彩光', '彩光嫩膚', '嫩膚療程', '去斑'],
      effect: '改善色斑、均勻膚色、收細毛孔、減淡細紋',
      suitable: '有曬斑、雀斑、膚色不均者',
      unsuitable: '孕婦、光敏感肌膚、剛曬太陽者',
      precaution: '療程後需加強防曬，一週內避免使用美白產品',
      duration: '30-45 分鐘',
      price: 'HK$800',
      discountPrice: 'HK$498',
      content: `IPL 彩光嫩膚利用脈衝光能量，針對黑色素，達到淡斑嫩膚效果。

療程優點：
- 無創傷性
- 恢復期短
- 可改善多種肌膚問題

建議療程次數：4-6 次（每 2-3 週一次）`,
      faqItems: [
        { question: 'IPL 會痛嗎？', answer: '過程會有輕微溫熱感，似橡皮筋彈一下，一般可以接受。' },
        { question: '做完會唔會紅？', answer: '可能有輕微泛紅，通常數小時內消退。' },
        { question: '幾耐見效？', answer: '一般 2-3 次後開始見到效果，完成整個療程效果最佳。' },
      ],
    },
    {
      id: 'svc-botox',
      title: 'Botox 瘦面療程',
      docType: DocType.SERVICE,
      aliases: ['Botox', '肉毒桿菌', '瘦面', '瘦面針', 'botox瘦面'],
      effect: '放鬆咀嚼肌、達到瘦面效果、改善國字臉',
      suitable: '咀嚼肌發達、國字臉型人士',
      unsuitable: '孕婦、哺乳中、重症肌無力症患者',
      precaution: '注射後 4 小時內避免平躺、一週內避免按摩注射部位',
      duration: '15-30 分鐘',
      price: 'HK$2500',
      discountPrice: 'HK$1800',
      content: `Botox 瘦面療程利用肉毒桿菌素放鬆咀嚼肌，達到瘦面效果。

療程特點：
- 療程快速
- 無恢復期
- 效果自然

效果維持：約 6-9 個月`,
      faqItems: [
        { question: 'Botox 瘦面幾耐見效？', answer: '一般 1-2 週開始見效，4-6 週效果最明顯。' },
        { question: '會唔會有副作用？', answer: '正常情況下副作用輕微，可能出現輕微瘀青或腫脹，數天內消退。' },
        { question: '要做幾多次？', answer: '建議每 6-9 個月做一次維持效果。' },
      ],
    },
  ];

  for (const svc of services) {
    await prisma.knowledgeDocument.upsert({
      where: { id: svc.id },
      update: {
        title: svc.title,
        docType: svc.docType,
        aliases: svc.aliases,
        effect: svc.effect,
        suitable: svc.suitable,
        unsuitable: svc.unsuitable,
        precaution: svc.precaution,
        duration: svc.duration,
        price: svc.price,
        discountPrice: svc.discountPrice,
        content: svc.content,
        faqItems: svc.faqItems,
      },
      create: {
        id: svc.id,
        tenantId: DEMO_TENANT_ID,
        title: svc.title,
        docType: svc.docType,
        aliases: svc.aliases,
        effect: svc.effect,
        suitable: svc.suitable,
        unsuitable: svc.unsuitable,
        precaution: svc.precaution,
        duration: svc.duration,
        price: svc.price,
        discountPrice: svc.discountPrice,
        content: svc.content,
        faqItems: svc.faqItems,
      },
    });
    console.log(`✅ Service: ${svc.title}`);
  }

  // Create general FAQs
  const faqs = [
    {
      id: 'faq-payment',
      title: '付款方式',
      docType: DocType.FAQ,
      content: '我們接受以下付款方式：\n\n1. 現金\n2. 信用卡（Visa、MasterCard、AE）\n3. 支付寶\n4. 微信支付\n5. 轉數快\n\n所有價格已包含香港稅項。',
    },
    {
      id: 'faq-hours',
      title: '營業時間',
      docType: DocType.FAQ,
      content: '我們的營業時間：\n\n星期一至五：10:00 - 21:00\n星期六：10:00 - 19:00\n星期日及公眾假期：休息\n\n預約熱線：+852 1234 5678\nWhatsApp：+852 1234 5678',
    },
    {
      id: 'faq-location',
      title: '地址及交通',
      docType: DocType.FAQ,
      content: '地址：香港銅鑼灣告士打道 123 號 大廈 A 座 8 樓\n\n交通：\n- 港鐵銅鑼灣站 C 出口，步行 5 分鐘\n- 巴士站：告士打道\n- 泊車：大廈地庫停車場（首 2 小時免費）',
    },
    {
      id: 'faq-booking',
      title: '預約流程',
      docType: DocType.FAQ,
      content: '預約方式：\n\n1. WhatsApp / 電話預約\n2. 親臨門市預約\n3. 網上預約（會員專享）\n\n預約須知：\n- 首次預約請提前 24 小時\n- 如需改期，請提前 4 小時通知\n- 遲到超過 15 分鐘，療程時間將相應縮短\n- 未能出席且無事先通知，需繳付 HK$200 行政費',
    },
    {
      id: 'faq-refund',
      title: '退款政策',
      docType: DocType.FAQ,
      content: '退款政策：\n\n- 未使用的預付款項可全額退款\n- 已使用的套票不設退款\n- 療程開始後不設退款\n- 特價優惠不設退款\n\n如有任何問題，請與我們聯絡。我們會盡力為你解決。',
    },
  ];

  for (const faq of faqs) {
    await prisma.knowledgeDocument.upsert({
      where: { id: faq.id },
      update: {
        title: faq.title,
        docType: faq.docType,
        content: faq.content,
      },
      create: {
        id: faq.id,
        tenantId: DEMO_TENANT_ID,
        title: faq.title,
        docType: faq.docType,
        content: faq.content,
      },
    });
    console.log(`✅ FAQ: ${faq.title}`);
  }

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