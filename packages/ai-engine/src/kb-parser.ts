/**
 * KB Parser - Deterministic parser for Knowledge Base imports
 *
 * Parses markdown/text documents into structured KB items.
 * Uses deterministic rules (headings, labels, tables) first.
 * LLM is fallback only.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type DocType = 'SERVICE' | 'FAQ' | 'GENERAL';

export interface ParsedKbItem {
  title: string;
  docType: DocType;
  category?: string;
  aliases: string[];
  content: string;
  // Structured fields
  effect?: string;
  suitable?: string;
  unsuitable?: string;
  precaution?: string;
  duration?: string;
  price?: string;
  discountPrice?: string;
  steps: string[];
  faqItems: Array<{ question: string; answer: string }>;
}

export interface ImportMode {
  type: 'SINGLE_ITEM' | 'MULTI_ITEM_CATALOG' | 'FAQ_DOC' | 'BRAND_DOC';
  confidence: number;
}

export interface ParseResult {
  mode: ImportMode;
  items: ParsedKbItem[];
  rawContent: string;
}

// ── Field Label Patterns ───────────────────────────────────────────────────────

const FIELD_LABELS = {
  effect: ['功效', '效果', '作用', '療效', '功效介紹', '效果介紹'],
  suitable: ['適合對象', '適合人士', '適合', '適用對象', '建議對象'],
  unsuitable: ['不適合對象', '不適合人士', '不適合', '禁忌人群', '注意對象'],
  precaution: ['注意事項', '注意', '禁忌', '注意事項及禁忌', '術後護理'],
  duration: ['時長', '時間', '療程時間', '需時', '所需時間'],
  price: ['價錢', '價格', '費用', '收費', '價目', '原價'],
  discountPrice: ['優惠價', '特價', '推廣價', '試做價', '新客價'],
  aliases: ['別名', '又名', '其他名稱', '英文名', '簡稱'],
  steps: ['步驟', '流程', '程序', '療程步驟', '治療流程'],
  faq: ['常見問題', 'FAQ', 'Q&A', '問答', '問題解答'],
};

const CATEGORY_LABELS = ['分類', '類別', '類型', '系列'];

const SERVICE_KEYWORDS = [
  '療程', '護理', '護膚', '美容', '療程', 'facial', 'treatment',
  'HIFU', 'Botox', 'IPL', 'laser', 'RF', 'RF射頻',
  '瘦身', '減肥', '緊緻', '提升', '嫩膚', '美白',
];

const FAQ_KEYWORDS = ['常見問題', 'FAQ', 'Q&A', '問答', '問題', '常見FAQ'];
const FAQ_QUESTION_PATTERN = /^##\s*\d+\.\s*(.+)$/;  // "## 1. 問題"
const QA_PATTERN = /^(?:Q[：:：]|問[：:：])/;  // "Q:" or "問:"

const BRAND_KEYWORDS = [
  '關於我們', '品牌', '公司簡介', '品牌故事', '我們的理念', '美容院資料',
  '基本資料', '營業時間', '地址', '聯絡', '付款方式', '預約政策'
];

const BRAND_SECTION_TITLES = [
  '基本資料', '營業時間', '交通方式', '美容院簡介', '品牌介紹', 'Branding 故事',
  '品牌故事', '品牌風格', '核心服務', '服務承諾', '適合客群', '預約', '取消政策',
  '付款方式', '術後跟進', '聯絡方法', '公司資料', '服務範圍', '分店資料'
];

// ── Price Extraction Patterns ────────────────────────────────────────────────

const PRICE_PATTERNS = [
  /HK\$[\d,]+/gi,
  /\$[\d,]+/gi,
  /[\d,]+元/gi,
  /價錢[：:]\s*[\d,]+/gi,
];

const DISCOUNT_PATTERNS = [
  /優惠價[：:]\s*HK\$[\d,]+/gi,
  /特價[：:]\s*HK\$[\d,]+/gi,
  /試做價[：:]\s*HK\$[\d,]+/gi,
];

// ── Core Functions ─────────────────────────────────────────────────────────────

/**
 * Detect import mode from content
 */
export function detectImportMode(content: string): ImportMode {
  const lines = content.split('\n').filter(l => l.trim());

  // Check for FAQ document FIRST: numbered questions like "## 1. 問題?"
  // This must be checked before numbered H2 for services
  const faqQuestionPattern = /^##\s*\d+\.\s*.+[？?？]$/gm;
  const faqQuestionMatches = content.match(faqQuestionPattern);
  if (faqQuestionMatches && faqQuestionMatches.length >= 3) {
    return { type: 'FAQ_DOC', confidence: 0.95 };
  }

  // Check for Q: / A: pattern
  const qaPatternCount = (content.match(/^(Q[：:：]|問[：:：])/gm) || []).length;
  if (qaPatternCount >= 3) {
    return { type: 'FAQ_DOC', confidence: 0.9 };
  }

  // Check for "常見FAQ" or "FAQ" in title
  if (/^#\s+.*(?:常見FAQ|FAQ|常見問題)/i.test(content)) {
    return { type: 'FAQ_DOC', confidence: 0.9 };
  }

  // Check for numbered H2 format (e.g., "## 1. Title", "## 2. Title") for services
  const numberedH2Pattern = /^##\s+\d+\.\s+.+$/gm;
  const numberedH2Matches = content.match(numberedH2Pattern);
  if (numberedH2Matches && numberedH2Matches.length >= 2) {
    // Check if these are service items (have price, effect, etc.)
    const hasServiceFields = /\*\*價錢\*\*|\*\*功效\*\*|\*\*優惠價\*\*|\*\*時長\*\*/.test(content);
    if (hasServiceFields) {
      return { type: 'MULTI_ITEM_CATALOG', confidence: 0.9 };
    }
  }

  // Check for brand/salon info document
  const brandSectionMatches = BRAND_SECTION_TITLES.filter(title =>
    content.includes(title)
  ).length;
  if (brandSectionMatches >= 3) {
    return { type: 'BRAND_DOC', confidence: 0.85 };
  }

  // Check for brand keywords
  const hasBrandKeywords = BRAND_KEYWORDS.some(kw =>
    content.toLowerCase().includes(kw.toLowerCase())
  );
  if (hasBrandKeywords) {
    return { type: 'BRAND_DOC', confidence: 0.7 };
  }

  // Check for FAQ keywords (only if not clearly a service catalog)
  const hasFaqKeywords = FAQ_KEYWORDS.some(kw =>
    content.toLowerCase().includes(kw.toLowerCase())
  );

  // Check for service keywords
  const serviceMatches = lines.filter(line =>
    SERVICE_KEYWORDS.some(kw => line.toLowerCase().includes(kw.toLowerCase()))
  ).length;

  // Count H2/H3 headings as potential items
  const headingMatches = content.match(/^#{2,3}\s+.+$/gm) || [];
  const potentialItems = headingMatches.length || serviceMatches;

  // If has service keywords and multiple headings, likely a catalog
  if (potentialItems >= 3 && serviceMatches > 0) {
    return { type: 'MULTI_ITEM_CATALOG', confidence: 0.8 };
  }

  // Only classify as FAQ_DOC if it's clearly a FAQ document (no service structure)
  if (hasFaqKeywords && potentialItems < 3 && serviceMatches === 0) {
    return { type: 'FAQ_DOC', confidence: 0.8 };
  }

  if (potentialItems >= 3) {
    return { type: 'MULTI_ITEM_CATALOG', confidence: 0.7 };
  }

  // Check for structured service fields
  const hasStructuredFields = Object.values(FIELD_LABELS).flat().some(label =>
    content.includes(label)
  );

  if (hasStructuredFields || serviceMatches > 0) {
    return { type: 'SINGLE_ITEM', confidence: 0.8 };
  }

  return { type: 'SINGLE_ITEM', confidence: 0.5 };
}

/**
 * Detect if content uses numbered H2 format (e.g., "## 1. Title", "## 2. Title")
 */
function isNumberedH2Format(content: string): boolean {
  // Match patterns like "## 1. Title", "## 2. Title", etc.
  const numberedH2Pattern = /^##\s+\d+\.\s+.+$/gm;
  const matches = content.match(numberedH2Pattern);
  return matches !== null && matches.length >= 2;
}

/**
 * Split multi-item catalog into individual items
 */
export function splitCatalogItems(content: string): string[] {
  // Check for numbered H2 format first (e.g., "## 1. Botox 瘦面療程")
  if (isNumberedH2Format(content)) {
    return splitByNumberedH2(content);
  }

  // Original logic for simple H2/H3 format
  const lines = content.split('\n');
  const items: string[] = [];
  let currentItem: string[] = [];
  let currentTitle = '';

  for (const line of lines) {
    // H2 or H3 heading = new item
    const headingMatch = line.match(/^#{2,3}\s+(.+)$/);
    if (headingMatch) {
      // Save previous item
      if (currentTitle && currentItem.length > 0) {
        items.push(currentItem.join('\n').trim());
      }
      currentTitle = headingMatch[1].trim();
      currentItem = [line];
    } else if (currentTitle) {
      currentItem.push(line);
    } else {
      // Content before first heading - treat as single item or preamble
      currentItem.push(line);
    }
  }

  // Save last item
  if (currentItem.length > 0) {
    items.push(currentItem.join('\n').trim());
  }

  // If no headings found, treat as single item
  if (items.length === 0) {
    items.push(content.trim());
  }

  return items.filter(item => item.length > 50); // Filter out very short items
}

/**
 * Split content by numbered H2 headers (e.g., "## 1. Title")
 */
function splitByNumberedH2(content: string): string[] {
  const lines = content.split('\n');
  const items: string[] = [];
  let currentItem: string[] = [];
  let foundFirstItem = false;

  for (const line of lines) {
    // Match numbered H2: "## 1. Title", "## 20. Title", etc.
    const numberedH2Match = line.match(/^##\s+\d+\.\s+(.+)$/);
    if (numberedH2Match) {
      // Save previous item (only if we've found the first real item)
      if (foundFirstItem && currentItem.length > 0) {
        items.push(currentItem.join('\n').trim());
      }
      currentItem = [line];
      foundFirstItem = true;
    } else if (foundFirstItem) {
      // Only add lines after we've found the first numbered H2
      currentItem.push(line);
    }
    // Skip content before the first numbered H2 (preamble)
  }

  // Save last item
  if (foundFirstItem && currentItem.length > 0) {
    items.push(currentItem.join('\n').trim());
  }

  return items.filter(item => item.length > 50);
}

/**
 * Split FAQ document into individual FAQ items
 */
function splitFaqItems(content: string): Array<{ question: string; answer: string }> {
  const faqItems: Array<{ question: string; answer: string }> = [];
  const lines = content.split('\n');

  let currentQuestion: string | null = null;
  let currentAnswer: string[] = [];
  let foundFirstQuestion = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Match "## N. 問題？" pattern (numbered question)
    const numberedQMatch = trimmed.match(/^##\s*\d+\.\s*(.+)$/);
    if (numberedQMatch) {
      // Save previous FAQ
      if (currentQuestion && currentAnswer.length > 0 && foundFirstQuestion) {
        faqItems.push({
          question: currentQuestion,
          answer: currentAnswer.join('\n').trim(),
        });
      }
      currentQuestion = numberedQMatch[1].trim();
      currentAnswer = [];
      foundFirstQuestion = true;
      continue;
    }

    // Match "Q:" or "問:" pattern
    const qaMatch = trimmed.match(/^(?:Q[：:：]|問[：:：])\s*(.+)$/);
    if (qaMatch) {
      // Save previous FAQ
      if (currentQuestion && currentAnswer.length > 0) {
        faqItems.push({
          question: currentQuestion,
          answer: currentAnswer.join('\n').trim(),
        });
      }
      currentQuestion = qaMatch[1].trim();
      currentAnswer = [];
      foundFirstQuestion = true;
      continue;
    }

    // Match "A:" or "答:" pattern (add to answer)
    const aaMatch = trimmed.match(/^(?:A[：:：]|答[：:：])\s*(.+)$/);
    if (aaMatch && currentQuestion) {
      currentAnswer.push(aaMatch[1].trim());
      continue;
    }

    // Add non-empty lines to current answer (only after first question found)
    if (currentQuestion && trimmed && foundFirstQuestion) {
      currentAnswer.push(trimmed);
    }
  }

  // Save last FAQ
  if (currentQuestion && currentAnswer.length > 0) {
    faqItems.push({
      question: currentQuestion,
      answer: currentAnswer.join('\n').trim(),
    });
  }

  return faqItems.filter(item => item.question.length > 0 && item.answer.length > 0);
}

/**
 * Split brand/salon document into sections
 */
function splitBrandSections(content: string): Array<{ title: string; category: string; content: string }> {
  const sections: Array<{ title: string; category: string; content: string }> = [];
  const lines = content.split('\n');

  let currentTitle: string | null = null;
  let currentContent: string[] = [];

  // Skip document title (H1)
  let foundFirstH2 = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Match H2 headings
    const h2Match = trimmed.match(/^##\s+(.+)$/);
    if (h2Match) {
      // Save previous section
      if (currentTitle && currentContent.length > 0 && foundFirstH2) {
        sections.push({
          title: currentTitle,
          category: 'SALON_INFO',
          content: currentContent.join('\n').trim(),
        });
      }

      currentTitle = h2Match[1].trim();
      currentContent = [];
      foundFirstH2 = true;
      continue;
    }

    // Add content to current section
    if (currentTitle && trimmed) {
      currentContent.push(trimmed);
    }
  }

  // Save last section
  if (currentTitle && currentContent.length > 0) {
    sections.push({
      title: currentTitle,
      category: 'SALON_INFO',
      content: currentContent.join('\n').trim(),
    });
  }

  return sections.filter(s => s.content.length > 20);
}

/**
 * Parse a single KB item from text
 */
export function parseKbItem(text: string, defaultTitle?: string): ParsedKbItem {
  const lines = text.split('\n');
  const item: ParsedKbItem = {
    title: '',
    docType: 'GENERAL',
    aliases: [],
    content: '',
    steps: [],
    faqItems: [],
  };

  // Check for numbered H2 format (e.g., "## 1. Botox 瘦面療程")
  const numberedH2Match = text.match(/^##\s+\d+\.\s+(.+)$/m);
  if (numberedH2Match) {
    // This is the new structured format
    return parseStructuredItem(text, numberedH2Match[1].trim());
  }

  // Extract title from first H1/H2
  for (const line of lines) {
    const h1Match = line.match(/^#\s+(.+)$/);
    const h2Match = line.match(/^#{2}\s+(.+)$/);
    if (h1Match) {
      item.title = h1Match[1].trim();
      break;
    } else if (h2Match && !item.title) {
      item.title = h2Match[1].trim();
      break;
    }
  }

  // Fallback title
  if (!item.title) {
    item.title = defaultTitle || lines[0]?.trim().substring(0, 50) || '未命名項目';
  }

  // Parse structured fields
  parseStructuredFields(text, item);

  // Determine docType
  item.docType = detectDocType(text, item);

  // Extract remaining content
  item.content = extractRemainingContent(text, item);

  return item;
}

/**
 * Parse item in structured format (numbered H2 with **標題：** style fields)
 */
function parseStructuredItem(text: string, extractedTitle: string): ParsedKbItem {
  const item: ParsedKbItem = {
    title: '',
    docType: 'SERVICE', // Default to SERVICE for this format
    aliases: [],
    content: '',
    steps: [],
    faqItems: [],
  };

  // Extract title from **標題：** pattern
  const titleMatch = text.match(/\*\*標題：\*\*\s*(.+?)(?:\n|$)/);
  item.title = titleMatch ? titleMatch[1].trim() : extractedTitle;

  // Extract aliases from **別名：** pattern
  const aliasesMatch = text.match(/\*\*別名：\*\*\s*(.+?)(?:\n|$)/);
  if (aliasesMatch) {
    item.aliases = aliasesMatch[1].split(/[,，、]/).map(s => s.trim()).filter(s => s);
  }

  // Extract category from **分類：** pattern
  const categoryMatch = text.match(/\*\*分類：\*\*\s*(.+?)(?:\n|$)/);
  if (categoryMatch) {
    item.category = categoryMatch[1].trim();
  }

  // Extract docType from **文檔類型：** pattern
  const docTypeMatch = text.match(/\*\*文檔類型：\*\*\s*(.+?)(?:\n|$)/);
  if (docTypeMatch) {
    const docTypeStr = docTypeMatch[1].trim().toLowerCase();
    if (docTypeStr.includes('faq') || docTypeStr.includes('常見問題')) {
      item.docType = 'FAQ';
    } else if (docTypeStr.includes('服務') || docTypeStr.includes('service')) {
      item.docType = 'SERVICE';
    } else {
      item.docType = 'GENERAL';
    }
  }

  // Extract from ### 服務詳情 section
  const serviceDetailsMatch = text.match(/###\s*服務詳情\s*\n([\s\S]*?)(?=###|$)/);
  if (serviceDetailsMatch) {
    const serviceSection = serviceDetailsMatch[1];

    // **價錢：**
    const priceMatch = serviceSection.match(/\*\*價錢：\*\*\s*(.+?)(?:\n|$)/);
    if (priceMatch) {
      item.price = priceMatch[1].trim();
    }

    // **優惠價：**
    const discountMatch = serviceSection.match(/\*\*優惠價：\*\*\s*(.+?)(?:\n|$)/);
    if (discountMatch) {
      item.discountPrice = discountMatch[1].trim();
    }

    // **功效：**
    const effectMatch = serviceSection.match(/\*\*功效：\*\*\s*(.+?)(?:\n|$)/);
    if (effectMatch) {
      item.effect = effectMatch[1].trim();
    }

    // **注意事項：**
    const precautionMatch = serviceSection.match(/\*\*注意事項：\*\*\s*(.+?)(?:\n|$)/);
    if (precautionMatch) {
      item.precaution = precautionMatch[1].trim();
    }

    // **時長：**
    const durationMatch = serviceSection.match(/\*\*時長：\*\*\s*(.+?)(?:\n|$)/);
    if (durationMatch) {
      item.duration = durationMatch[1].trim();
    }
  }

  // Extract steps from ### 步驟 section
  const stepsMatch = text.match(/###\s*步驟\s*\n([\s\S]*?)(?=###|$)/);
  if (stepsMatch) {
    item.steps = extractStepsFromSection(stepsMatch[1]);
  }

  // Extract FAQ from ### 常見問題 FAQ section
  const faqMatch = text.match(/###\s*常見問題\s*FAQ\s*\n([\s\S]*?)(?=###|$)/);
  if (faqMatch) {
    item.faqItems = extractFaqsFromSection(faqMatch[1]);
  }

  // Extract content from ### 內容 section
  const contentMatch = text.match(/###\s*內容\s*\n([\s\S]*?)(?=---|$)/);
  if (contentMatch) {
    item.content = contentMatch[1].trim();
  }

  return item;
}

/**
 * Extract steps from a section text (numbered list)
 */
function extractStepsFromSection(text: string): string[] {
  const steps: string[] = [];
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    // Match numbered steps: "1. xxx" or "1、xxx" or "1:xxx"
    const stepMatch = trimmed.match(/^\d+[.、:：]\s*(.+)$/);
    if (stepMatch) {
      steps.push(stepMatch[1].trim());
    }
  }

  return steps;
}

/**
 * Extract FAQ items from a section text
 */
function extractFaqsFromSection(text: string): Array<{ question: string; answer: string }> {
  const faqs: Array<{ question: string; answer: string }> = [];
  const lines = text.split('\n');

  let currentQ: string | null = null;
  let currentA: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Match **Q1：xxx** or **Q：xxx** pattern
    const qMatch = trimmed.match(/\*\*Q\d*[：:]\s*(.+?)\*\*/);
    if (qMatch) {
      if (currentQ && currentA.length > 0) {
        faqs.push({ question: currentQ, answer: currentA.join('\n').trim() });
      }
      currentQ = qMatch[1].trim();
      currentA = [];
      continue;
    }

    // Match **A1：xxx** or **A：xxx** pattern
    const aMatch = trimmed.match(/\*\*A\d*[：:]\s*(.+?)\*\*/);
    if (aMatch) {
      currentA.push(aMatch[1].trim());
      continue;
    }

    // Also try Q：xxx without markdown bold
    const qMatchSimple = trimmed.match(/^Q\d*[：:]\s*(.+)$/);
    if (qMatchSimple) {
      if (currentQ && currentA.length > 0) {
        faqs.push({ question: currentQ, answer: currentA.join('\n').trim() });
      }
      currentQ = qMatchSimple[1].trim();
      currentA = [];
      continue;
    }

    // Also try A：xxx without markdown bold
    const aMatchSimple = trimmed.match(/^A\d*[：:]\s*(.+)$/);
    if (aMatchSimple) {
      currentA.push(aMatchSimple[1].trim());
      continue;
    }

    // Add to current answer if we have a question
    if (currentQ && trimmed) {
      currentA.push(trimmed);
    }
  }

  // Save last FAQ
  if (currentQ && currentA.length > 0) {
    faqs.push({ question: currentQ, answer: currentA.join('\n').trim() });
  }

  return faqs;
}

/**
 * Parse structured fields from text
 */
function parseStructuredFields(text: string, item: ParsedKbItem): void {
  const sections = splitSections(text);

  for (const section of sections) {
    const label = section.label;
    const content = section.content.trim();

    if (!content) continue;

    // Match to field - exact match or contains
    const matchField = (labels: string[]): boolean => {
      return labels.some(l => label === l || label.includes(l));
    };

    // Check unsuitable BEFORE suitable (since "不適合" contains "適合")
    if (matchField(FIELD_LABELS.unsuitable)) {
      item.unsuitable = content;
    } else if (matchField(FIELD_LABELS.suitable)) {
      item.suitable = content;
    } else if (matchField(FIELD_LABELS.effect)) {
      item.effect = content;
    } else if (matchField(FIELD_LABELS.precaution)) {
      item.precaution = content;
    } else if (matchField(FIELD_LABELS.duration)) {
      item.duration = content;
    } else if (matchField(FIELD_LABELS.price)) {
      const prices = extractPrices(content);
      if (prices.price) item.price = prices.price;
      if (prices.discountPrice) item.discountPrice = prices.discountPrice;
      else item.price = content;
    } else if (matchField(FIELD_LABELS.discountPrice)) {
      item.discountPrice = extractPrice(content) || content;
    } else if (matchField(FIELD_LABELS.aliases)) {
      item.aliases = content.split(/[,、，\/]/).map(s => s.trim()).filter(s => s);
    } else if (matchField(FIELD_LABELS.steps)) {
      item.steps = extractSteps(content);
    } else if (matchField(FIELD_LABELS.faq)) {
      item.faqItems = extractFaqs(content);
    } else if (matchField(CATEGORY_LABELS)) {
      item.category = content;
    }
  }

  // Also try to extract prices from anywhere in text
  if (!item.price || !item.discountPrice) {
    const prices = extractPricesFromText(text);
    if (!item.price && prices.price) item.price = prices.price;
    if (!item.discountPrice && prices.discountPrice) item.discountPrice = prices.discountPrice;
  }
}

/**
 * Split text into labeled sections using bold markers
 */
function splitSections(text: string): Array<{ label: string; content: string }> {
  const sections: Array<{ label: string; content: string }> = [];
  const lines = text.split('\n');

  let currentLabel = '';
  let currentContent: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check for bold label pattern: **功效** or **適合對象**
    const boldMatch = trimmed.match(/^\*\*(.+?)\*\*\s*$/);
    if (boldMatch) {
      // Save previous section if exists
      if (currentLabel && currentContent.length > 0) {
        sections.push({
          label: currentLabel,
          content: currentContent.join('\n').trim(),
        });
      }
      // Start new section
      currentLabel = boldMatch[1].trim();
      currentContent = [];
      continue;
    }

    // Add content to current section (skip empty lines at start of section)
    if (currentLabel && trimmed) {
      currentContent.push(trimmed);
    }
  }

  // Save last section
  if (currentLabel && currentContent.length > 0) {
    sections.push({
      label: currentLabel,
      content: currentContent.join('\n').trim(),
    });
  }

  return sections;
}

/**
 * Extract price and discount price from text
 */
function extractPrices(text: string): { price?: string; discountPrice?: string } {
  const result: { price?: string; discountPrice?: string } = {};

  // Find discount price first
  for (const pattern of DISCOUNT_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      result.discountPrice = match[0].replace(/[^\d]/g, '');
      break;
    }
  }

  // Find regular price
  for (const pattern of PRICE_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      const prices = matches.map(m => m.replace(/[^\d]/g, '')).filter(p => p);
      if (prices.length > 0) {
        // If discount exists, the higher price is original
        if (result.discountPrice) {
          const discountNum = parseInt(result.discountPrice);
          const regularPrices = prices.map(p => parseInt(p)).filter(p => p > discountNum);
          if (regularPrices.length > 0) {
            result.price = 'HK$' + regularPrices[0];
          }
        } else {
          result.price = 'HK$' + prices[0];
        }
      }
      break;
    }
  }

  return result;
}

/**
 * Extract single price from text
 */
function extractPrice(text: string): string | null {
  const match = text.match(/HK\$[\d,]+/i) || text.match(/\$[\d,]+/i);
  return match ? match[0] : null;
}

/**
 * Extract prices from full text
 */
function extractPricesFromText(text: string): { price?: string; discountPrice?: string } {
  const lines = text.split('\n');
  let price: string | undefined;
  let discountPrice: string | undefined;

  for (const line of lines) {
    const lower = line.toLowerCase();

    if (lower.includes('優惠') || lower.includes('特價') || lower.includes('試做')) {
      const found = extractPrice(line);
      if (found) discountPrice = found;
    } else if (lower.includes('價') || lower.includes('費用')) {
      const found = extractPrice(line);
      if (found && !price) price = found;
    }
  }

  // If no labeled prices found, look for any price pattern
  if (!price && !discountPrice) {
    const allPrices = text.match(/HK\$[\d,]+/gi) || [];
    if (allPrices.length === 1) {
      price = allPrices[0];
    } else if (allPrices.length >= 2) {
      // Assume higher is regular, lower is discount
      const nums = allPrices.map(p => parseInt(p.replace(/[^\d]/g, '')));
      const sorted = nums.sort((a, b) => b - a);
      price = 'HK$' + sorted[0];
      discountPrice = 'HK$' + sorted[sorted.length - 1];
    }
  }

  return { price, discountPrice };
}

/**
 * Extract numbered steps
 */
function extractSteps(text: string): string[] {
  const steps: string[] = [];
  const lines = text.split('\n');

  let inSteps = false;
  for (const line of lines) {
    const trimmed = line.trim();

    // Check for numbered list
    const numMatch = trimmed.match(/^(\d+)[.、:]\s*(.+)$/);
    if (numMatch) {
      inSteps = true;
      steps.push(numMatch[2].trim());
      continue;
    }

    // Check for bullet list
    const bulletMatch = trimmed.match(/^[-*•]\s*(.+)$/);
    if (bulletMatch && inSteps) {
      steps.push(bulletMatch[1].trim());
      continue;
    }

    // End of steps section
    if (inSteps && trimmed && !trimmed.startsWith('  ')) {
      break;
    }
  }

  return steps;
}

/**
 * Extract FAQ items
 */
function extractFaqs(text: string): Array<{ question: string; answer: string }> {
  const faqs: Array<{ question: string; answer: string }> = [];
  const lines = text.split('\n');

  let currentQ: string | null = null;
  let currentA: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Q: or 問: pattern
    const qMatch = trimmed.match(/^(?:Q[：:]|問[：:]|\d+\.\s*)(.+)$/);
    if (qMatch) {
      if (currentQ && currentA.length > 0) {
        faqs.push({ question: currentQ, answer: currentA.join('\n').trim() });
      }
      currentQ = qMatch[1].trim();
      currentA = [];
      continue;
    }

    // A: or 答: pattern
    const aMatch = trimmed.match(/^(?:A[：:]|答[：:])(.*)$/);
    if (aMatch) {
      currentA.push(aMatch[1].trim());
      continue;
    }

    // Add to current answer
    if (currentQ && trimmed) {
      currentA.push(trimmed);
    }
  }

  // Save last FAQ
  if (currentQ && currentA.length > 0) {
    faqs.push({ question: currentQ, answer: currentA.join('\n').trim() });
  }

  return faqs;
}

/**
 * Detect document type from content
 */
function detectDocType(text: string, item: ParsedKbItem): DocType {
  // If has structured service fields, it's a SERVICE
  const serviceFields = [item.effect, item.suitable, item.unsuitable, item.precaution, item.price, item.duration];
  const hasServiceFields = serviceFields.some(f => f && f.length > 0);

  if (hasServiceFields) {
    return 'SERVICE';
  }

  // If has FAQ items, it's FAQ
  if (item.faqItems && item.faqItems.length > 0) {
    return 'FAQ';
  }

  // Check keywords
  const lower = text.toLowerCase();
  if (SERVICE_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()))) {
    return 'SERVICE';
  }

  if (FAQ_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()))) {
    return 'FAQ';
  }

  return 'GENERAL';
}

/**
 * Extract remaining content after structured fields
 */
function extractRemainingContent(text: string, item: ParsedKbItem): string {
  // Remove already extracted sections
  let remaining = text;

  // Remove headings for extracted fields
  const removeSection = (content: string, fieldLabels: string[]) => {
    for (const label of fieldLabels) {
      const regex = new RegExp(`^#{1,3}\\s*${label}[：:]?.*$`, 'gm');
      content = content.replace(regex, '');
    }
    return content;
  };

  remaining = removeSection(remaining, FIELD_LABELS.effect);
  remaining = removeSection(remaining, FIELD_LABELS.suitable);
  remaining = removeSection(remaining, FIELD_LABELS.unsuitable);
  remaining = removeSection(remaining, FIELD_LABELS.precaution);
  remaining = removeSection(remaining, FIELD_LABELS.duration);
  remaining = removeSection(remaining, FIELD_LABELS.price);
  remaining = removeSection(remaining, FIELD_LABELS.discountPrice);
  remaining = removeSection(remaining, FIELD_LABELS.aliases);
  remaining = removeSection(remaining, FIELD_LABELS.steps);
  remaining = removeSection(remaining, FIELD_LABELS.faq);
  remaining = removeSection(remaining, CATEGORY_LABELS);

  // Clean up multiple newlines
  remaining = remaining.replace(/\n{3,}/g, '\n\n').trim();

  return remaining;
}

/**
 * Main parse function - entry point
 */
export function parseImportContent(content: string, filename?: string): ParseResult {
  // Normalize line endings
  const normalized = content.replace(/\r\n/g, '\n');

  // Detect import mode
  const mode = detectImportMode(normalized);

  let items: ParsedKbItem[];

  if (mode.type === 'MULTI_ITEM_CATALOG') {
    // Split into multiple service items
    const itemTexts = splitCatalogItems(normalized);
    items = itemTexts.map((text, i) =>
      parseKbItem(text, `項目 ${i + 1}`)
    );
  } else if (mode.type === 'FAQ_DOC') {
    // Split FAQ document into individual FAQ items
    const faqItems = splitFaqItems(normalized);
    items = faqItems.map((faq, i) => ({
      title: faq.question,
      docType: 'FAQ' as DocType,
      category: 'FAQ',
      aliases: [],
      content: faq.answer,
      steps: [],
      faqItems: [],
    }));
  } else if (mode.type === 'BRAND_DOC') {
    // Split brand/salon document into sections
    const brandSections = splitBrandSections(normalized);
    items = brandSections.map((section, i) => ({
      title: section.title,
      docType: 'GENERAL' as DocType,
      category: section.category,
      aliases: [],
      content: section.content,
      steps: [],
      faqItems: [],
    }));
  } else {
    // Single item
    const item = parseKbItem(normalized, filename?.replace(/\.[^/.]+$/, ''));
    items = [item];
  }

  return {
    mode,
    items,
    rawContent: content,
  };
}