/**
 * customer-signals.ts
 *
 * Defines CustomerSignals - the internal state variables that represent
 * what we understand about the customer at any given moment.
 *
 * Key principle: Signals are COMPUTED, not guessed.
 * Each signal is derived from observable behaviors in the conversation.
 */

// ── Signal Types ───────────────────────────────────────────────────────────────

/**
 * Customer emotion state.
 * Derived from: word choice, punctuation, message length, response timing.
 */
export type EmotionType =
  | 'calm'        // Neutral, conversational
  | 'confused'    // Unclear, asking multiple questions
  | 'anxious'     // Worried, asking about risks/timing
  | 'impatient'   // Short replies, rushing
  | 'angry'       // Frustrated, using negative language
  | 'distrustful'; // Skeptical, questioning claims

/**
 * Type of sales resistance.
 * Derived from: objection content, hesitation patterns, questions asked.
 */
export type ResistanceType =
  | 'none'       // No resistance detected
  | 'price'       // "Too expensive", "Can I get discount?"
  | 'trust'       // "Are you sure?", "I've had bad experiences"
  | 'timing'      // "I need to think about it", "Maybe later"
  | 'need'        // "I'm not sure if I need this", "What's the difference?"
  | 'other';      // Vague or unclear resistance

/**
 * Customer's decision readiness level.
 * 0 = Just browsing, 1 = Curious, 2 = Considering, 3 = Ready, 4 = Decided, 5 = Urgent
 */
export type ReadinessLevel = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * Customer's trust level.
 * 0 = Hostile, 1 = Skeptical, 2 = Neutral, 3 = Open, 4 = Trusting, 5 = Confident
 */
export type TrustLevel = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * Customer's communication style.
 * Derived from: message patterns, question types, response length.
 */
export type CustomerStyle =
  | 'direct'      // Short, to the point, wants quick answers
  | 'analytical'  // Asks details, compares, wants specs
  | 'supportive'  // Friendly, conversational, values relationship
  | 'social';     // Chatty, shares stories, values connection

// ── Signal Interface ────────────────────────────────────────────────────────────

/**
 * Complete customer signal state.
 * This is the "customer understanding" that guides all decisions.
 */
export interface CustomerSignals {
  // Primary signals
  emotion: EmotionType;
  resistance: ResistanceType;
  readiness: ReadinessLevel;
  trust: TrustLevel;
  style: CustomerStyle;

  // Derived metrics
  engagementScore: number;     // 0-100: How actively engaged
  riskScore: number;           // 0-100: Risk of losing customer
  urgencyLevel: number;        // 0-100: How urgent is their need

  // Context
  conversationTurn: number;    // How many messages exchanged
  topicHistory: string[];      // What topics discussed
  previousPurchases: number;   // Past purchase count (if known)
  lastPurchaseDate: Date | null;
}

// ── Signal Detection Context ───────────────────────────────────────────────────

/**
 * Context needed to compute signals.
 */
export interface SignalDetectionContext {
  message: string;
  intent: string;
  conversationHistory: Array<{
    sender: 'CUSTOMER' | 'AI' | 'HUMAN';
    content: string;
    timestamp: string;
    intent?: string;
  }>;
  bookingProgress: {
    hasService: boolean;
    hasDate: boolean;
    hasTime: boolean;
    hasContact: boolean;
  };
  previousSignals: CustomerSignals | null;
}

// ── Emotion Detection ──────────────────────────────────────────────────────────

const EMOTION_PATTERNS: Record<EmotionType, {
  keywords: RegExp[];
  weight: number;
}> = {
  calm: {
    keywords: [/謝謝|感謝|明白|了解|好的|ok|可以|冇問題/i],
    weight: 1,
  },
  confused: {
    keywords: [/唔明|唔清楚|即係|點解|其實|吓\?|係咪|係唔係|點樣|邊個|咩意思/i],
    weight: 1.5,
  },
  anxious: {
    keywords: [/驚|擔心|會唔會|風險|安全|副作用|痛唔痛|幾耐|要唔要|會點|會唔會有問題/i],
    weight: 1.5,
  },
  impatient: {
    keywords: [/快啲|幾時|等|仲未|即刻|而家|算了|唔使|直接講|簡單啲/i],
    weight: 1.3,
  },
  angry: {
    keywords: [/不滿|投訴|垃圾|伏|呃|欺詐|垃圾|廢|差|唔滿意|退錢|退款|賠償|垃圾/i],
    weight: 2,
  },
  distrustful: {
    keywords: [/真係|真的嗎|係咪呃|有冇|保證|肯定|確定|信唔信|懷疑|未必/i],
    weight: 1.5,
  },
};

function detectEmotion(message: string, history: SignalDetectionContext['conversationHistory']): EmotionType {
  let bestMatch: EmotionType = 'calm';
  let bestScore = 0;

  for (const [emotion, pattern] of Object.entries(EMOTION_PATTERNS)) {
    let score = 0;
    for (const regex of pattern.keywords) {
      if (regex.test(message)) {
        score += pattern.weight;
      }
    }

    // Check recent history for emotion patterns
    const recentMessages = history.slice(-3);
    for (const msg of recentMessages) {
      if (msg.sender === 'CUSTOMER') {
        for (const regex of pattern.keywords) {
          if (regex.test(msg.content)) {
            score += pattern.weight * 0.3; // Lower weight for historical messages
          }
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = emotion as EmotionType;
    }
  }

  return bestMatch;
}

// ── Resistance Detection ──────────────────────────────────────────────────────

const RESISTANCE_PATTERNS: Record<ResistanceType, RegExp[]> = {
  none: [],
  price: [/太貴|好貴|幾錢|平啲|折扣|優惠|會員價|可以平|有冇得平|預算/i],
  trust: [/真係|會唔會|信唔信|試過|經驗|安全|風險|副作用|保證|肯定/i],
  timing: [/考慮|諗下|遲啲|下次|再聯絡|唔急|慢慢|唔係好急|要諗|唔使咁快/i],
  need: [/唔係好需要|用唔用得著|值唔值|有咩用|有咩分別|同...有咩唔同|點解要/i],
  other: [/唔係好想|唔係好確定|再算|再睇/i],
};

function detectResistance(message: string): ResistanceType {
  for (const [type, patterns] of Object.entries(RESISTANCE_PATTERNS)) {
    if (type === 'none') continue;
    for (const pattern of patterns) {
      if (pattern.test(message)) {
        return type as ResistanceType;
      }
    }
  }
  return 'none';
}

// ── Readiness Detection ─────────────────────────────────────────────────────────

const READINESS_INDICATORS = {
  // Browsing: 0
  browsing: [/唔使|只是問|問下|了解下|看看|睇睇|參考/i],
  // Curious: 1
  curious: [/想知|想了解|介紹|有咩|點樣|幾多|什麼/i],
  // Considering: 2
  considering: [/比較|分別|唔同|好唔好|點揀|邊個好|值得/i],
  // Ready: 3
  ready: [/想約|預約|book|幾時有位|幾時得|可以約/i],
  // Decided: 4
  decided: [/就呢個|要呢個|book|約|訂|confirm/i],
  // Urgent: 5
  urgent: [/急|快|即刻|今日|聽日|盡快|馬上|立即/i],
};

function detectReadiness(message: string, bookingProgress: SignalDetectionContext['bookingProgress']): ReadinessLevel {
  // If booking is in progress, readiness is at least 3
  if (bookingProgress.hasService) {
    if (bookingProgress.hasDate && bookingProgress.hasTime && bookingProgress.hasContact) {
      return 4; // Decided
    }
    if (bookingProgress.hasDate || bookingProgress.hasTime) {
      return 4; // Decided
    }
    return 3; // Ready
  }

  // Check message patterns
  if (READINESS_INDICATORS.urgent.some(p => p.test(message))) return 5;
  if (READINESS_INDICATORS.decided.some(p => p.test(message))) return 4;
  if (READINESS_INDICATORS.ready.some(p => p.test(message))) return 3;
  if (READINESS_INDICATORS.considering.some(p => p.test(message))) return 2;
  if (READINESS_INDICATORS.curious.some(p => p.test(message))) return 1;

  return 0; // Browsing
}

// ── Trust Detection ─────────────────────────────────────────────────────────────

function detectTrust(
  message: string,
  history: SignalDetectionContext['conversationHistory'],
  previousSignals: CustomerSignals | null,
): TrustLevel {
  // Base trust from previous signals
  let trust = previousSignals?.trust ?? 2; // Default: neutral

  // Positive signals
  if (/謝謝|感謝|明白|了解|好的|ok|可以|冇問題|明白|清楚/i.test(message)) {
    trust = Math.min(5, trust + 1) as TrustLevel;
  }
  if (/已經用過|做過|試過|舊客|再嚟/i.test(message)) {
    trust = Math.min(5, trust + 2) as TrustLevel;
  }

  // Negative signals
  if (/唔明|唔清楚|搞錯|錯|唔係|唔係咁/i.test(message)) {
    trust = Math.max(0, trust - 1) as TrustLevel;
  }
  if (/投訴|不滿|差|伏|呃|欺詐/i.test(message)) {
    trust = Math.max(0, trust - 2) as TrustLevel;
  }

  // History-based adjustment
  const turnCount = history.filter(h => h.sender === 'CUSTOMER').length;
  if (turnCount > 5 && trust >= 2) {
    // Long conversation with neutral+ trust = slight increase
    trust = Math.min(5, trust + 1) as TrustLevel;
  }

  return trust;
}

// ── Style Detection ────────────────────────────────────────────────────────────

const STYLE_INDICATORS = {
  direct: {
    patterns: [/就|直接|簡單|快|講重點|直接講|唔使講咁多/i],
    avgMessageLength: [0, 30],
  },
  analytical: {
    patterns: [/分別|比較|點樣|幾多|邊個|什麼|詳細|具體|規格/i],
    avgMessageLength: [20, 100],
  },
  supportive: {
    patterns: [/謝謝|唔該|辛苦|明白|理解|體諒/i],
    avgMessageLength: [15, 80],
  },
  social: {
    patterns: [/其實|本身|之前|話|講開|咁樣|哈哈|嘻嘻|😄|😊/i],
    avgMessageLength: [30, 200],
  },
};

function detectStyle(message: string, history: SignalDetectionContext['conversationHistory']): CustomerStyle {
  const avgLength = history
    .filter(h => h.sender === 'CUSTOMER')
    .reduce((sum, h) => sum + h.content.length, message.length) /
    (history.filter(h => h.sender === 'CUSTOMER').length + 1);

  let bestMatch: CustomerStyle = 'supportive'; // Default
  let bestScore = 0;

  for (const [style, indicators] of Object.entries(STYLE_INDICATORS)) {
    let score = 0;

    // Pattern matching
    for (const pattern of indicators.patterns) {
      if (pattern.test(message)) {
        score += 1;
      }
    }

    // Length matching
    const [minLen, maxLen] = indicators.avgMessageLength;
    if (avgLength >= minLen && avgLength <= maxLen) {
      score += 0.5;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = style as CustomerStyle;
    }
  }

  return bestMatch;
}

// ── Main Signal Detection Function ─────────────────────────────────────────────

/**
 * Computes customer signals from conversation context.
 * This is the entry point for signal detection.
 */
export function detectCustomerSignals(ctx: SignalDetectionContext): CustomerSignals {
  const { message, conversationHistory, bookingProgress, previousSignals } = ctx;

  // Detect primary signals
  const emotion = detectEmotion(message, conversationHistory);
  const resistance = detectResistance(message);
  const readiness = detectReadiness(message, bookingProgress);
  const trust = detectTrust(message, conversationHistory, previousSignals);
  const style = detectStyle(message, conversationHistory);

  // Compute derived metrics
  const engagementScore = computeEngagementScore(ctx, readiness, trust);
  const riskScore = computeRiskScore(emotion, resistance, trust);
  const urgencyLevel = computeUrgencyLevel(message, readiness);

  // Track conversation progress
  const conversationTurn = conversationHistory.filter(h => h.sender === 'CUSTOMER').length + 1;
  const topicHistory = extractTopicHistory(message, conversationHistory);

  return {
    emotion,
    resistance,
    readiness,
    trust,
    style,
    engagementScore,
    riskScore,
    urgencyLevel,
    conversationTurn,
    topicHistory,
    previousPurchases: previousSignals?.previousPurchases ?? 0,
    lastPurchaseDate: previousSignals?.lastPurchaseDate ?? null,
  };
}

// ── Derived Metrics Computation ────────────────────────────────────────────────

function computeEngagementScore(
  ctx: SignalDetectionContext,
  readiness: ReadinessLevel,
  trust: TrustLevel,
): number {
  let score = 50; // Base

  // Readiness contributes
  score += readiness * 8;

  // Trust contributes
  score += trust * 5;

  // Message length contributes (longer = more engaged, to a point)
  const msgLen = ctx.message.length;
  if (msgLen >= 20 && msgLen <= 150) score += 10;
  else if (msgLen > 150) score += 5;

  // Questions indicate engagement
  const questionCount = (ctx.message.match(/\?|？/g) || []).length;
  score += Math.min(questionCount * 5, 15);

  return Math.max(0, Math.min(100, score));
}

function computeRiskScore(
  emotion: EmotionType,
  resistance: ResistanceType,
  trust: TrustLevel,
): number {
  let score = 20; // Base risk (low)

  // Emotion contributes
  const emotionRisk: Record<EmotionType, number> = {
    calm: 0,
    confused: 15,
    anxious: 20,
    impatient: 30,
    angry: 60,
    distrustful: 40,
  };
  score += emotionRisk[emotion];

  // Resistance contributes
  const resistanceRisk: Record<ResistanceType, number> = {
    none: 0,
    price: 20,
    trust: 35,
    timing: 15,
    need: 25,
    other: 10,
  };
  score += resistanceRisk[resistance];

  // Low trust contributes
  if (trust <= 1) score += 30;
  else if (trust === 2) score += 10;

  return Math.max(0, Math.min(100, score));
}

function computeUrgencyLevel(message: string, readiness: ReadinessLevel): number {
  let score = readiness * 15; // Base from readiness

  // Urgent keywords
  if (/急|快|即刻|今日|聽日|盡快|馬上|立即|今晚/i.test(message)) {
    score += 30;
  }

  // Time constraints
  if (/星期|週|幾時|什麼時候|when/i.test(message)) {
    score += 10;
  }

  return Math.max(0, Math.min(100, score));
}

function extractTopicHistory(
  message: string,
  history: SignalDetectionContext['conversationHistory'],
): string[] {
  const topics: string[] = [];

  // Extract topics from message
  if (/價|錢|費|收費|幾錢/.test(message)) topics.push('price');
  if (/功效|效果|好唔好|有用|作用/.test(message)) topics.push('effect');
  if (/預約|book|約|訂/.test(message)) topics.push('booking');
  if (/時間|幾耐|多久/.test(message)) topics.push('duration');
  if (/地點|地址|在哪|邊度/.test(message)) topics.push('location');
  if (/注意|注意事項|風險|副作用/.test(message)) topics.push('precaution');

  // Extract from history
  for (const msg of history.slice(-5)) {
    if (/價|錢|費|收費|幾錢/.test(msg.content)) topics.push('price');
    if (/功效|效果|好唔好|有用|作用/.test(msg.content)) topics.push('effect');
    if (/預約|book|約|訂/.test(msg.content)) topics.push('booking');
  }

  // Deduplicate
  return [...new Set(topics)];
}

// ── Signal Summary for Display/Logging ────────────────────────────────────────

/**
 * Human-readable summary of signals.
 */
export function summarizeSignals(signals: CustomerSignals): string {
  const parts: string[] = [];

  parts.push(`情緒:${signals.emotion}`);
  parts.push(`信任:${signals.trust}/5`);
  parts.push(`準備度:${signals.readiness}/5`);
  if (signals.resistance !== 'none') {
    parts.push(`阻力:${signals.resistance}`);
  }
  parts.push(`風格:${signals.style}`);
  parts.push(`參與:${signals.engagementScore}%`);
  if (signals.riskScore > 30) {
    parts.push(`風險:${signals.riskScore}%`);
  }

  return parts.join(' | ');
}

// ── Regression Tests ────────────────────────────────────────────────────────────

export function verifyCustomerSignalsRegression(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  // Test emotion detection
  const angryResult = detectCustomerSignals({
    message: '我要投訴，你哋服務好差！',
    intent: 'COMPLAINT',
    conversationHistory: [],
    bookingProgress: { hasService: false, hasDate: false, hasTime: false, hasContact: false },
    previousSignals: null,
  });
  if (angryResult.emotion !== 'angry') {
    failures.push(`Emotion detection failed: expected 'angry', got '${angryResult.emotion}'`);
  }

  // Test resistance detection
  const priceResistance = detectCustomerSignals({
    message: '太貴了，有冇得平啲？',
    intent: 'PRICE',
    conversationHistory: [],
    bookingProgress: { hasService: false, hasDate: false, hasTime: false, hasContact: false },
    previousSignals: null,
  });
  if (priceResistance.resistance !== 'price') {
    failures.push(`Resistance detection failed: expected 'price', got '${priceResistance.resistance}'`);
  }

  // Test readiness detection
  const readyCustomer = detectCustomerSignals({
    message: '我想預約聽日下午3點',
    intent: 'BOOKING',
    conversationHistory: [],
    bookingProgress: { hasService: true, hasDate: false, hasTime: false, hasContact: false },
    previousSignals: null,
  });
  if (readyCustomer.readiness < 3) {
    failures.push(`Readiness detection failed: expected >= 3, got ${readyCustomer.readiness}`);
  }

  // Test trust increase
  const trustingCustomer = detectCustomerSignals({
    message: '好的，謝謝你解釋',
    intent: 'OTHER',
    conversationHistory: [
      { sender: 'AI', content: 'HIFU 價錢係 HK$4980', timestamp: '2026-01-01T10:00:00Z' },
      { sender: 'CUSTOMER', content: '我想問 HIFU', timestamp: '2026-01-01T10:01:00Z' },
    ],
    bookingProgress: { hasService: false, hasDate: false, hasTime: false, hasContact: false },
    previousSignals: { emotion: 'calm', resistance: 'none', readiness: 1, trust: 2, style: 'supportive', engagementScore: 50, riskScore: 20, urgencyLevel: 15, conversationTurn: 2, topicHistory: [], previousPurchases: 0, lastPurchaseDate: null },
  });
  if (trustingCustomer.trust < 3) {
    failures.push(`Trust increase failed: expected >= 3, got ${trustingCustomer.trust}`);
  }

  return { ok: failures.length === 0, failures };
}