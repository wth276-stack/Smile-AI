const { PrismaClient } = require('./packages/database');
const p = new PrismaClient();

const tenantId = 'demo-tenant';

const docs = [
  {
    tenantId,
    title: '激光去斑',
    content: '利用先進激光技術，針對色斑、雀斑、太陽斑等問題，減淡色斑、均勻膚色。療程約45分鐘，建議每月一次。',
    docType: 'SERVICE',
    aliases: ['去斑', '激光祛斑', 'laser'],
    price: 'HK$2,800',
    duration: '45分鐘',
    effect: '減淡色斑、均勻膚色',
    suitable: '面部有色斑、膚色不均人士',
    precaution: '療程後需注意防曬，避免即時化妝',
    isActive: true,
  },
  {
    tenantId,
    title: 'HIFU 緊緻提升療程',
    content: '高強度聚焦超聲波，刺激膠原蛋白增生，達到提升輪廓、緊緻皮膚效果。療程約60分鐘。',
    docType: 'SERVICE',
    aliases: ['HIFU', '超聲刀', '緊緻', '提升'],
    price: 'HK$3,800',
    duration: '60分鐘',
    effect: '提升輪廓、緊緻皮膚、刺激膠原增生',
    suitable: '面部鬆弛、輪廓下垂人士',
    precaution: '療程後可能有輕微泛紅，24小時內避免高溫',
    isActive: true,
  },
  {
    tenantId,
    title: '水光針保濕嫩膚療程',
    content: '透過微針將透明質酸直接注入皮膚底層，深層補水、改善膚質。療程約30分鐘。',
    docType: 'SERVICE',
    aliases: ['水光針', '保濕', '補水'],
    price: 'HK$2,200',
    duration: '30分鐘',
    effect: '深層補水、改善膚質、提升光澤',
    suitable: '皮膚乾燥、缺水、暗啞人士',
    precaution: '療程後6小時內避免碰水及化妝',
    isActive: true,
  },
  {
    tenantId,
    title: '營業時間',
    content: '星期一至五：10:00 - 20:00\n星期六：10:00 - 18:00\n星期日及公眾假期休息',
    docType: 'GENERAL',
    aliases: ['開門', '幾點開', '營業'],
    isActive: true,
  },
];

(async () => {
  for (const doc of docs) {
    const created = await p.knowledgeDocument.create({ data: doc });
    console.log(`Created: [${created.docType}] ${created.title} (${created.id})`);
  }
  const count = await p.knowledgeDocument.count({ where: { tenantId, isActive: true } });
  console.log(`\nTotal active docs for tenant: ${count}`);
  await p.$disconnect();
})();
