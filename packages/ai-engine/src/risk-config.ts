/**
 * risk-config.ts
 *
 * Configuration for risk-based A/B testing and customer routing.
 * Higher risk customers get more conservative strategies.
 */

/**
 * Risk level thresholds.
 */
export const RISK_THRESHOLDS = {
  /** Low risk: normal sales process */
  LOW: 30,
  /** Medium risk: cautious approach, no push */
  MEDIUM: 50,
  /** High risk: conservative approach, early handoff */
  HIGH: 70,
} as const;

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

type LowRiskConfig = typeof RISK_MODIFIERS.LOW;
type MediumRiskConfig = typeof RISK_MODIFIERS.MEDIUM;
type HighRiskConfig = typeof RISK_MODIFIERS.HIGH;
type CriticalRiskConfig = typeof RISK_MODIFIERS.CRITICAL;

/**
 * Risk-based strategy modifiers.
 * Applied on top of base strategy selection.
 */
export const RISK_MODIFIERS = {
  /** Low risk (0-30): Standard approach */
  LOW: {
    maxPushBooking: true,
    maxUpsell: true,
    fasterClose: true,
    handoffThreshold: 70,
    description: 'Standard sales approach, can push booking and upsell',
  },
  /** Medium risk (31-50): Cautious approach */
  MEDIUM: {
    maxPushBooking: false,
    maxUpsell: false,
    fasterClose: false,
    handoffThreshold: 60,
    description: 'Cautious approach, no aggressive tactics',
  },
  /** High risk (51-70): Very conservative */
  HIGH: {
    maxPushBooking: false,
    maxUpsell: false,
    fasterClose: false,
    handoffThreshold: 50,
    description: 'Very conservative, prioritize trust-building',
  },
  /** Critical risk (>70): Handoff recommended */
  CRITICAL: {
    maxPushBooking: false,
    maxUpsell: false,
    fasterClose: false,
    handoffThreshold: 0, // Always handoff
    description: 'Critical risk, handoff to human immediately',
  },
} as const;

/**
 * Gets the risk level for a given score.
 */
export function getRiskLevel(score: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  if (score > RISK_THRESHOLDS.HIGH) return 'CRITICAL';
  if (score > RISK_THRESHOLDS.MEDIUM) return 'HIGH';
  if (score > RISK_THRESHOLDS.LOW) return 'MEDIUM';
  return 'LOW';
}

/**
 * Gets risk modifier configuration for a score.
 */
export function getRiskModifier(score: number): LowRiskConfig | MediumRiskConfig | HighRiskConfig | CriticalRiskConfig {
  const level = getRiskLevel(score);
  return RISK_MODIFIERS[level];
}

/**
 * A/B test group assignment based on risk.
 * This can be used to route customers to different experiment groups.
 */
export type ExperimentGroup = 'control' | 'conservative' | 'nurture';

/**
 * Assigns experiment group based on risk and random bucket.
 * Higher risk customers are more likely to be in conservative groups.
 */
export function assignExperimentGroup(
  riskScore: number,
  _conversationId: string, // Used for deterministic assignment
): ExperimentGroup {
  const level = getRiskLevel(riskScore);

  // Low risk: mostly control, some nurture
  if (level === 'LOW') {
    return 'control';
  }

  // Medium risk: nurture group
  if (level === 'MEDIUM') {
    return 'nurture';
  }

  // High/Critical: conservative approach
  return 'conservative';
}

/**
 * Strategy modifications based on experiment group.
 */
export const EXPERIMENT_STRATEGY_ADJUSTMENTS = {
  control: {
    // Standard strategy - no modifications
    additionalMustDo: [] as string[],
    additionalForbidden: [] as string[],
    toneAdjustment: null as string | null,
  },
  nurture: {
    // Focus on relationship building
    additionalMustDo: ['build_trust', 'ask_need'],
    additionalForbidden: ['hard_close', 'pressure'],
    toneAdjustment: 'friendly',
  },
  conservative: {
    // Minimal risk, early handoff
    additionalMustDo: ['acknowledge_customer', 'offer_help'],
    additionalForbidden: ['push_booking', 'upsell', 'hard_close', 'pressure'],
    toneAdjustment: 'empathetic',
  },
} as const;

/**
 * Applies experiment adjustments to a strategy.
 */
export function applyExperimentAdjustments(
  baseMustDo: string[],
  baseForbidden: string[],
  baseTone: string,
  experimentGroup: ExperimentGroup,
): {
  mustDo: string[];
  forbidden: string[];
  tone: string;
} {
  const adjustments = EXPERIMENT_STRATEGY_ADJUSTMENTS[experimentGroup];

  return {
    mustDo: [...baseMustDo, ...adjustments.additionalMustDo],
    forbidden: [...baseForbidden, ...adjustments.additionalForbidden],
    tone: adjustments.toneAdjustment || baseTone,
  };
}

/**
 * Checks if handoff should be triggered based on risk.
 */
export function shouldHandoffByRisk(
  riskScore: number,
  correctionCount: number = 0,
): {
  shouldHandoff: boolean;
  reason: string;
} {
  const level = getRiskLevel(riskScore);
  const modifier = getRiskModifier(riskScore);

  // Critical risk: always handoff
  if (level === 'CRITICAL') {
    return {
      shouldHandoff: true,
      reason: `Critical risk score (${riskScore})`,
    };
  }

  // High risk with corrections: handoff
  if (level === 'HIGH' && correctionCount >= 1) {
    return {
      shouldHandoff: true,
      reason: `High risk (${riskScore}) with ${correctionCount} correction(s)`,
    };
  }

  // Medium risk with multiple corrections: handoff
  if (level === 'MEDIUM' && correctionCount >= 2) {
    return {
      shouldHandoff: true,
      reason: `Medium risk (${riskScore}) with ${correctionCount} correction(s)`,
    };
  }

  return {
    shouldHandoff: false,
    reason: `Risk score ${riskScore} below threshold`,
  };
}

/**
 * Regression tests for risk configuration.
 */
export function verifyRiskConfigRegression(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  // Test 1: Risk levels
  if (getRiskLevel(10) !== 'LOW') {
    failures.push(`Score 10 should be LOW, got ${getRiskLevel(10)}`);
  }
  if (getRiskLevel(35) !== 'MEDIUM') {
    failures.push(`Score 35 should be MEDIUM, got ${getRiskLevel(35)}`);
  }
  if (getRiskLevel(55) !== 'HIGH') {
    failures.push(`Score 55 should be HIGH, got ${getRiskLevel(55)}`);
  }
  if (getRiskLevel(80) !== 'CRITICAL') {
    failures.push(`Score 80 should be CRITICAL, got ${getRiskLevel(80)}`);
  }

  // Test 2: Handoff by risk
  const critical = shouldHandoffByRisk(85, 0);
  if (!critical.shouldHandoff) {
    failures.push('Critical risk should handoff');
  }

  const highWithCorrection = shouldHandoffByRisk(60, 1);
  if (!highWithCorrection.shouldHandoff) {
    failures.push('High risk with correction should handoff');
  }

  const low = shouldHandoffByRisk(20, 0);
  if (low.shouldHandoff) {
    failures.push('Low risk should not handoff');
  }

  // Test 3: Experiment groups
  if (assignExperimentGroup(10, 'conv1') !== 'control') {
    failures.push('Low risk should be control group');
  }
  if (assignExperimentGroup(40, 'conv2') !== 'nurture') {
    failures.push('Medium risk should be nurture group');
  }
  if (assignExperimentGroup(75, 'conv3') !== 'conservative') {
    failures.push('Critical risk should be conservative group');
  }

  // Test 4: Risk modifiers
  const lowMod = getRiskModifier(10);
  if (!lowMod.maxPushBooking) {
    failures.push('Low risk should allow push booking');
  }

  const highMod = getRiskModifier(60);
  if (highMod.maxPushBooking) {
    failures.push('High risk should not allow push booking');
  }

  return { ok: failures.length === 0, failures };
}