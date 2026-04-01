export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export const CONVERSATION_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 min

export const MAX_MESSAGES_PER_AI_CONTEXT = 20;

export const PLANS = ['STARTER', 'GROWTH', 'ELITE'] as const;
export type Plan = (typeof PLANS)[number];

export const PHASE_FEATURES: Record<Plan, string[]> = {
  STARTER: [
    'conversations',
    'contacts',
    'orders',
    'bookings',
    'followups',
    'reminders',
    'knowledge_base',
    'dashboard',
  ],
  GROWTH: [
    'lead_scoring',
    'sales_pipeline',
    'objection_handling',
    'handoff',
    'playbooks',
    'conversation_summary',
  ],
  ELITE: [
    'decision_identity',
    'upsell_engine',
    'closing_reinforcement',
    'tone_adaptation',
    'analytics_loop',
  ],
};
