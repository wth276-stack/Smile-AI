/**
 * Parse kb/beauty-salon markdown service blocks (plain 功效： / 試做價： labels, not bold).
 */

export interface ParsedServiceDoc {
  title: string;
  category: string | null;
  isPackage: boolean;
  price: string | null;
  discountPrice: string | null;
  effect: string | null;
  suitable: string | null;
  unsuitable: string | null;
  precaution: string | null;
  duration: string | null;
  steps: string[];
  faqItems: Array<{ question: string; answer: string }>;
  pairing: string | null;
  /** Package: raw 包含 bullets */
  includedLines: string[];
  /** Package: 注意 bullets */
  restrictionLines: string[];
  /** Package: 有效期 line text */
  validityText: string | null;
}

/** Section labels that start a new block (first line is `名稱：…`) */
const SECTION_KEYS = [
  '分類',
  '試做價',
  '正價',
  '價錢',
  '套餐價',
  '功效',
  '適合人群',
  '不適合人群',
  '療程時長',
  '療程步驟',
  '療程後注意事項',
  '常見問題',
  '推薦配搭',
  '包含',
  '注意',
  '有效期',
] as const;

export function normalizeSectionName(line: string): string | null {
  const t = line.trim();
  if (!t) return null;
  if (/^##\s*服務名稱[：:]/.test(t)) return null;
  if (/^Q[：:]/.test(t)) return null;
  if (/^A[：:]/.test(t)) return null;
  const m = t.match(/^([^：:]+)[：:]/);
  if (!m) return null;
  let name = m[1].trim();
  if (name.startsWith('適合人群')) return '適合人群';
  if (name.startsWith('不適合人群')) return '不適合人群';
  return name;
}

function collectUntilNextSection(
  lines: string[],
  startIdx: number,
  current: string,
): { text: string; nextIdx: number } {
  const parts: string[] = [];
  let i = startIdx;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (/^---+\s*$/.test(line.trim())) {
      break;
    }
    const n = normalizeSectionName(line);
    if (n !== null && n !== current && SECTION_KEYS.includes(n as (typeof SECTION_KEYS)[number])) {
      break;
    }
    parts.push(line);
  }
  return { text: parts.join('\n').trim(), nextIdx: i };
}

function parseQaSection(text: string): Array<{ question: string; answer: string }> {
  const items: Array<{ question: string; answer: string }> = [];
  const lines = text.split('\n');
  let q: string | null = null;
  let aBuf: string[] = [];
  const flush = () => {
    if (q && aBuf.length) {
      items.push({ question: q, answer: aBuf.join('\n').trim() });
    }
    q = null;
    aBuf = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const qm = line.match(/^Q[：:：]\s*(.+)$/);
    const am = line.match(/^A[：:：]\s*(.+)$/);
    if (qm) {
      flush();
      q = qm[1].trim();
    } else if (am && q) {
      aBuf.push(am[1].trim());
    } else if (q && line) {
      aBuf.push(line);
    }
  }
  flush();
  return items;
}

export function splitServiceBlocks(markdown: string): string[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(/^##\s*服務名稱[：:]\s*(.+)$/);
    if (m) {
      const chunk: string[] = [line];
      i++;
      while (i < lines.length && !/^##\s*服務名稱[：:]/.test(lines[i].trim())) {
        chunk.push(lines[i]);
        i++;
      }
      blocks.push(chunk.join('\n').trim());
      continue;
    }
    i++;
  }
  return blocks;
}

export function parseServiceBlock(block: string): ParsedServiceDoc {
  const lines = block.split('\n');
  const titleLine = lines[0]?.match(/^##\s*服務名稱[：:]\s*(.+)$/);
  const title = titleLine ? titleLine[1].trim() : '未命名';

  const doc: ParsedServiceDoc = {
    title,
    category: null,
    isPackage: false,
    price: null,
    discountPrice: null,
    effect: null,
    suitable: null,
    unsuitable: null,
    precaution: null,
    duration: null,
    steps: [],
    faqItems: [],
    pairing: null,
    includedLines: [],
    restrictionLines: [],
    validityText: null,
  };

  let i = 1;
  while (i < lines.length) {
    const line = lines[i];
    const name = normalizeSectionName(line);

    if (!name) {
      i++;
      continue;
    }

    if (name === '分類') {
      const rest = line.replace(/^[^：:]+[：:]\s*/, '').trim();
      doc.category = rest;
      doc.isPackage = /套餐/.test(rest);
      i++;
      continue;
    }
    if (name === '試做價') {
      doc.discountPrice = line.replace(/^[^：:]+[：:]\s*/, '').trim();
      i++;
      continue;
    }
    if (name === '正價') {
      const v = line.replace(/^[^：:]+[：:]\s*/, '').trim();
      if (/HKD|HK\$|\d/.test(v)) doc.price = v;
      i++;
      continue;
    }
    if (name === '價錢') {
      doc.price = line.replace(/^[^：:]+[：:]\s*/, '').trim();
      i++;
      continue;
    }
    if (name === '套餐價') {
      const rest = line.replace(/^[^：:]+[：:]\s*/, '').trim();
      doc.discountPrice = rest;
      const orig = rest.match(/原價\s*(HKD?\s*[\d,]+)/i);
      if (orig) doc.price = orig[1].replace(/\s+/g, ' ').trim();
      i++;
      continue;
    }
    if (name === '功效') {
      i++;
      const { text, nextIdx } = collectUntilNextSection(lines, i, '功效');
      doc.effect = text;
      i = nextIdx;
      continue;
    }
    if (name === '適合人群') {
      i++;
      const { text, nextIdx } = collectUntilNextSection(lines, i, '適合人群');
      doc.suitable = text;
      i = nextIdx;
      continue;
    }
    if (name === '不適合人群') {
      i++;
      const { text, nextIdx } = collectUntilNextSection(lines, i, '不適合人群');
      doc.unsuitable = text;
      i = nextIdx;
      continue;
    }
    if (name === '療程時長') {
      doc.duration = line.replace(/^[^：:]+[：:]\s*/, '').trim();
      i++;
      continue;
    }
    if (name === '療程步驟') {
      i++;
      const { text, nextIdx } = collectUntilNextSection(lines, i, '療程步驟');
      doc.steps = text
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      i = nextIdx;
      continue;
    }
    if (name === '療程後注意事項') {
      i++;
      const { text, nextIdx } = collectUntilNextSection(lines, i, '療程後注意事項');
      doc.precaution = text;
      i = nextIdx;
      continue;
    }
    if (name === '常見問題') {
      i++;
      const { text, nextIdx } = collectUntilNextSection(lines, i, '常見問題');
      doc.faqItems = parseQaSection(text);
      i = nextIdx;
      continue;
    }
    if (name === '推薦配搭') {
      i++;
      const { text, nextIdx } = collectUntilNextSection(lines, i, '推薦配搭');
      doc.pairing = text;
      i = nextIdx;
      continue;
    }
    if (name === '包含') {
      i++;
      const { text, nextIdx } = collectUntilNextSection(lines, i, '包含');
      doc.includedLines = text
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s.startsWith('-'));
      i = nextIdx;
      continue;
    }
    if (name === '注意') {
      i++;
      const { text, nextIdx } = collectUntilNextSection(lines, i, '注意');
      doc.restrictionLines = text
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s.startsWith('-'));
      i = nextIdx;
      continue;
    }
    if (name === '有效期') {
      doc.validityText = line.replace(/^[^：:]+[：:]\s*/, '').trim();
      i++;
      continue;
    }
    i++;
  }

  return doc;
}

/** Build searchable content for standard services */
export function buildServiceContent(p: ParsedServiceDoc): string {
  const parts: string[] = [];
  if (p.category) parts.push(`分類：${p.category}`);
  if (p.effect) parts.push(`功效：\n${p.effect}`);
  if (p.suitable) parts.push(`適合人群：\n${p.suitable}`);
  if (p.unsuitable) parts.push(`不適合人群：\n${p.unsuitable}`);
  if (p.pairing) parts.push(`推薦配搭：\n${p.pairing}`);
  return parts.join('\n\n').trim();
}

/** Package: explicit 包含 + counts + validity + restrictions per requirements */
export function buildPackageContent(p: ParsedServiceDoc): string {
  const parts: string[] = [];
  if (p.category) parts.push(`分類：${p.category}`);
  if (p.effect) parts.push(`套餐目標／功效：\n${p.effect}`);
  if (p.suitable) parts.push(`適合人群：\n${p.suitable}`);

  parts.push('【包含項目】');
  if (p.includedLines.length) {
    parts.push(p.includedLines.join('\n'));
    const count = p.includedLines.length;
    parts.push(`\n項目數量：${count} 項`);
  } else if (p.pairing) {
    parts.push('（見推薦配搭／內文）');
  }

  if (p.validityText) {
    parts.push(`\n【有效期／使用期限】\n${p.validityText}`);
  }
  if (p.restrictionLines.length) {
    parts.push(`\n【限制／注意】\n${p.restrictionLines.join('\n')}`);
  }
  if (p.precaution) {
    parts.push(`\n療程後注意事項：\n${p.precaution}`);
  }
  return parts.join('\n').trim();
}

/** Grounded aliases from title + obvious shorthand from source */
export function buildAliases(p: ParsedServiceDoc): string[] {
  const t = p.title;
  const set = new Set<string>([t]);

  const paren = t.match(/（([^）]+)）/g);
  if (paren) {
    for (const x of paren) {
      const inner = x.replace(/[（）]/g, '').trim();
      if (inner.length >= 2 && inner.length < 40) set.add(inner);
    }
  }
  const en = t.match(/([A-Za-z][A-Za-z\s]{1,40})/);
  if (en) {
    const w = en[1].trim();
    if (w.length >= 2) set.add(w);
  }

  if (/Eye Treatment/i.test(t)) {
    set.add('Eye Treatment');
    set.add('眼部特別護理');
    set.add('眼部護理');
  }
  if (/彩光（IPL）|IPL/i.test(t)) {
    set.add('彩光（IPL）嫩膚');
    set.add('IPL');
    set.add('彩光嫩膚');
  }
  if (/HIFU/i.test(t)) {
    set.add('HIFU');
    set.add('HIFU 高強度聚焦超聲波');
    set.add('高強度聚焦超聲波');
  }
  if (/射頻（RF）|RF/i.test(t)) {
    set.add('射頻（RF）緊緻療程');
    set.add('RF');
    set.add('射頻緊緻');
  }
  if (/Gel Nail|凝膠甲/i.test(t)) {
    set.add('凝膠甲');
    set.add('Gel Nail');
  }
  if (/深層清潔 Facial/i.test(t)) {
    set.add('深層清潔 Facial');
    set.add('深層清潔');
    set.add('Facial');
  }
  if (/補水保濕/i.test(t)) {
    set.add('補水保濕療程');
    set.add('補水保濕');
  }
  if (/新客三合一/i.test(t)) {
    set.add('新客三合一體驗套餐');
    set.add('新客三合一');
    set.add('三合一體驗');
  }

  return [...set].filter((s) => s.length >= 2);
}

export const KB_SOURCE_FILES = [
  '01-臉部護理.md',
  '02-激光與緊緻提升.md',
  '03-眼部身體與脫毛.md',
  '04-美甲與套餐優惠.md',
] as const;

export interface NormalizedKbRow {
  title: string;
  docType: 'SERVICE' | 'FAQ';
  content: string;
  price: string | null;
  discountPrice: string | null;
  effect: string | null;
  suitable: string | null;
  unsuitable: string | null;
  precaution: string | null;
  duration: string | null;
  steps: string[];
  faqItems: Array<{ question: string; answer: string }>;
  aliases: string[];
  category: string | null;
}

export function toNormalizedRow(p: ParsedServiceDoc): NormalizedKbRow {
  const aliases = buildAliases(p);
  const content = p.isPackage ? buildPackageContent(p) : buildServiceContent(p);
  return {
    title: p.title,
    docType: 'SERVICE',
    content,
    price: p.price,
    discountPrice: p.discountPrice,
    effect: p.effect,
    suitable: p.suitable,
    unsuitable: p.unsuitable,
    precaution: p.precaution,
    duration: p.duration,
    steps: p.steps,
    faqItems: p.faqItems,
    aliases,
    category: p.category,
  };
}

/** Fixed FAQ titles + grouped Q/A from 05-通用FAQ與使用指引.md */
export function buildTopicalFaqDocs(): NormalizedKbRow[] {
  return [
    {
      title: '預約與改期取消 FAQ',
      docType: 'FAQ',
      content:
        '預約渠道、改期及取消預約相關說明（來源：美容院 KB 05 通用 FAQ）。',
      price: null,
      discountPrice: null,
      effect: null,
      suitable: null,
      unsuitable: null,
      precaution: null,
      duration: null,
      steps: [],
      faqItems: [
        {
          question: '如何預約？',
          answer:
            '可以透過 WhatsApp、網頁或致電預約，我哋 24 小時 AI 助手可以幫你記錄預約意向，同事確認後會回覆你。',
        },
        {
          question: '如何取消或更改預約？',
          answer: '請於預約時間 24 小時前通知，以便安排其他客人。',
        },
      ],
      aliases: ['預約', '改期', '取消預約', '更改預約'],
      category: 'FAQ',
    },
    {
      title: '訂金與試做價 FAQ',
      docType: 'FAQ',
      content: '訂金政策及試做價與正價分別（來源：美容院 KB 05 通用 FAQ）。',
      price: null,
      discountPrice: null,
      effect: null,
      suitable: null,
      unsuitable: null,
      precaution: null,
      duration: null,
      steps: [],
      faqItems: [
        {
          question: '需要預付訂金嗎？',
          answer:
            '首次預約無需訂金。如有特別安排（套餐、激光療程）可能需要少量訂金。',
        },
        {
          question: '試做價同正價有咩分別？',
          answer: '療程內容完全相同，試做價係新客戶優惠，每個療程限用一次。',
        },
      ],
      aliases: ['訂金', '試做價', '正價', '新客'],
      category: 'FAQ',
    },
    {
      title: '付款方式 FAQ',
      docType: 'FAQ',
      content: '付款方式說明（來源：美容院 KB 05 通用 FAQ）。',
      price: null,
      discountPrice: null,
      effect: null,
      suitable: null,
      unsuitable: null,
      precaution: null,
      duration: null,
      steps: [],
      faqItems: [
        {
          question: '可以用信用卡付款嗎？',
          answer: '可以，接受 Visa、Mastercard、八達通、PayMe、WeChat Pay。',
        },
      ],
      aliases: ['付款', '信用卡', 'Visa', 'Mastercard', '八達通', 'PayMe'],
      category: 'FAQ',
    },
    {
      title: '安全與副作用 FAQ',
      docType: 'FAQ',
      content: '療程安全及副作用相關說明（來源：美容院 KB 05 通用 FAQ）。',
      price: null,
      discountPrice: null,
      effect: null,
      suitable: null,
      unsuitable: null,
      precaution: null,
      duration: null,
      steps: [],
      faqItems: [
        {
          question: '療程安全嗎？',
          answer:
            '所有療程均由持牌美容師操作，使用認證儀器。如有任何健康問題，請預約前告知。',
        },
        {
          question: '有無副作用？',
          answer:
            '大部分療程副作用輕微（短暫泛紅），會在文件內詳細說明。如有疑慮可以先諮詢。',
        },
      ],
      aliases: ['安全', '副作用', '持牌美容師'],
      category: 'FAQ',
    },
    {
      title: '懷孕與禁忌 FAQ',
      docType: 'FAQ',
      content: '懷孕及禁忌相關說明（來源：美容院 KB 05 通用 FAQ）。',
      price: null,
      discountPrice: null,
      effect: null,
      suitable: null,
      unsuitable: null,
      precaution: null,
      duration: null,
      steps: [],
      faqItems: [
        {
          question: '懷孕可以做美容嗎？',
          answer:
            '部分療程可以，部分需要避免。請預約時告知懷孕狀態，我哋會推薦適合的療程。',
        },
      ],
      aliases: ['懷孕', '禁忌', '孕婦'],
      category: 'FAQ',
    },
    {
      title: '會員優惠 FAQ',
      docType: 'FAQ',
      content: '會員優惠說明（來源：美容院 KB 05 通用 FAQ）。',
      price: null,
      discountPrice: null,
      effect: null,
      suitable: null,
      unsuitable: null,
      precaution: null,
      duration: null,
      steps: [],
      faqItems: [
        {
          question: '有無會員優惠？',
          answer:
            '有，詳情可以向同事查詢或留下聯絡方式，我哋會發送會員計劃資料。',
        },
      ],
      aliases: ['會員', '優惠', '會員計劃'],
      category: 'FAQ',
    },
  ];
}
