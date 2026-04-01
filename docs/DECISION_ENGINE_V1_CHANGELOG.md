# Decision Engine v1 整合紀錄

**日期**: 2026-03-29
**版本**: v1.0.0

---

## 概述

本次更新整合了 Decision Engine v1 到 AI Engine，實現了：
1. 客戶訊號檢測（情緒、信任度、購買準備度、阻力、溝通風格）
2. 對話階段識別（18 個階段）
3. 策略選擇器（25+ 條規則）
4. 回應組件系統
5. LLM 策略護欄（mustDo/forbidden 約束）
6. 風險評分 A/B Testing 框架
7. Dashboard 訊號顯示

---

## 架構設計

```
用戶訊息
    │
    ▼
┌─────────────────────────────────────┐
│ Phase 1.5A/B/C/D (現有路由)         │
│ - Hardcoded FAQs                    │
│ - Service Detail Questions          │
│ - KB FAQ Matching                   │
└─────────────────────────────────────┘
    │ if no match
    ▼
┌─────────────────────────────────────┐
│ Decision Engine v1                  │
│ 1. detectCustomerSignals()          │
│ 2. detectStage()                    │
│ 3. selectStrategy()                 │
│    - Risk-based adjustments          │
│    - Experiment group routing       │
│ 4. selectComponents()               │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ LLM Pipeline                        │
│ - Strategy guard in system prompt   │
│ - Response validation               │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ Rule-based Fallback                  │
│ - Mode routing                       │
│ - Response composition               │
└─────────────────────────────────────┘
```

---

## 新增檔案

### `packages/ai-engine/src/conversation-stage.ts`
對話階段檢測模組。

**18 個階段**:
- `greeting` - 問候
- `discover` - 探索需求
- `clarify` - 釐清
- `answer` - 回答
- `recommend` - 推薦
- `objection` - 異議
- `price_discuss` - 價格討論
- `negotiate` - 協商
- `booking_init` - 預約開始
- `booking_slots` - 收集資料
- `confirm` - 確認
- `post_booking` - 預約完成
- `complaint` - 投訴
- `repair` - 修復
- `escalation` - 轉交
- `follow_up` - 跟進
- `upsell` - 加購
- `close` - 結束
- `unknown` - 未知

**關鍵函數**:
```typescript
export function detectStage(ctx: StageDetectionContext): StageDetectionResult
export function isValidStageTransition(from: ConversationStage, to: ConversationStage): boolean
export function getDefaultStageForMode(mode: BaseConversationMode): ConversationStage
```

---

### `packages/ai-engine/src/customer-signals.ts`
客戶訊號檢測模組。

**訊號類型**:
- `emotion`: 'happy' | 'calm' | 'neutral' | 'confused' | 'frustrated' | 'angry' | 'anxious'
- `resistance`: 'none' | 'price' | 'timing' | 'trust' | 'need' | 'competition'
- `readiness`: 0-5 (購買準備度)
- `trust`: 0-5 (信任度)
- `style`: 'supportive' | 'analytical' | 'direct' | 'exploratory'

**計算指標**:
- `engagementScore`: 參與度評分 (0-100)
- `riskScore`: 風險評分 (0-100)
- `urgencyLevel`: 緊急程度 (0-100)

---

### `packages/ai-engine/src/strategy-selector.ts`
策略選擇器模組。

**策略規則** (25+ 條):
- 每條規則包含 `condition`, `strategy`, `mustDo`, `niceToDo`, `forbidden`, `tone`, `urgency`
- 規則按優先級排序，首次匹配獲勝
- 高風險客戶 (riskScore > 70) 強制升級為 `escalate` 策略

**關鍵函數**:
```typescript
export function selectStrategy(ctx: StrategySelectionContext): StrategyConfig
export function summarizeStrategy(config: StrategyConfig): string
```

---

### `packages/ai-engine/src/response-components.ts`
回應組件庫。

**組件類別**:
- `empathy_opener` - 同理開場
- `clarify_question` - 釐清問題
- `booking_prompt` - 預約提示
- `objection_handle` - 異議處理
- `price_explain` - 價格說明
- `closing_element` - 結尾元素
- 等 50+ 組件

---

### `packages/ai-engine/src/decision-engine.ts`
決策引擎主模組。

```typescript
export class ConversationDecisionEngine {
  process(input: DecisionEngineInput): DecisionEngineOutput
}

export function runDecisionEngine(input: DecisionEngineInput): DecisionEngineOutput
```

**處理流程**:
1. `detectCustomerSignals()` - 檢測訊號
2. `detectStage()` - 識別階段
3. `selectStrategy()` - 選擇策略
4. `selectComponents()` - 選擇組件

---

### `packages/ai-engine/src/llm-strategy-guard.ts`
LLM 策略護欄模組。

**功能**:
- `buildStrategyGuardPrompt()` - 生成帶有策略約束的 LLM 系統提示
- `validateResponseAgainstStrategy()` - 驗證 LLM 回應是否符合 mustDo/forbidden
- `getStageGuidance()` - 獲取階段特定的回應指導

**範例提示結構**:
```
## 對話階段
你目前處於「discover」階段。

## 客戶狀態
- 情緒：calm
- 信任程度：3/5
- 購買準備度：2/5
- 溝通風格：supportive

## 當前策略
策略：discover_need
原因：Customer is exploring

### 必須做到（Must Do）
- 詢問客戶需要
- 積極聆聽

### 絕對禁止（Forbidden）
- 不要強迫預約
- 不要推銷額外服務
```

---

### `packages/ai-engine/src/risk-config.ts`
風險評分與 A/B Testing 框架。

**風險等級**:
| 等級 | 分數範圍 | 行為 |
|------|----------|------|
| LOW | ≤30 | 標準流程，可推動預約 |
| MEDIUM | 31-50 | 謹慎處理，不使用積極策略 |
| HIGH | 51-70 | 非常保守，優先建立信任 |
| CRITICAL | >70 | 立即轉交人工 |

**實驗組分配**:
```typescript
export function assignExperimentGroup(
  riskScore: number,
  conversationId: string,
): 'control' | 'nurture' | 'conservative'
```

- LOW → `control` (標準策略)
- MEDIUM → `nurture` (關係培養)
- HIGH/CRITICAL → `conservative` (保守策略)

**自動轉交觸發**:
- CRITICAL 風險：立即轉交
- HIGH 風險 + 1 次修正：轉交
- MEDIUM 風險 + 2 次修正：轉交

---

### `packages/ai-engine/src/business-rule-validator.ts`
P5 Lite: 營業規則驗證。

**驗證項目**:
- 營業日檢查
- 營業時間檢查
- 預約提前時間 (lead time)
- 當日預約截止時間

**預設配置**:
```typescript
export const DEFAULT_BUSINESS_HOURS: BusinessHoursConfig = {
  operatingDays: [1, 2, 3, 4, 5, 6], // 週一至週六
  openHour: 10,
  closeHour: 20,
  minLeadHours: 2,
  sameDayCutoffHour: 14,
};
```

---

### `packages/ai-engine/src/handoff-trigger.ts`
P7 Lite: 轉交人工觸發器。

**觸發條件**:
- `multiple_corrections` - 多次修正 (≥3 次)
- `ambiguous_datetime` - 模糊時間
- `low_confidence_service` - 服務識別信心不足
- `special_request` - 特殊要求
- `explicit_handoff` - 明確要求轉交

---

## 修改檔案

### `packages/ai-engine/src/orchestrator.ts`

**新增**:
- `buildEarlyDecisionInput()` - 在 LLM 調用前構建決策輸入
- Decision Engine 調用整合
- 訊號持久化到回應

**流程變更**:
```typescript
// 原本:
const llmResult = await tryLlmPlannerPipeline(input, priorMode, priorConfirmationPending);

// 現在:
const earlyDecisionInput = buildEarlyDecisionInput(input, priorMode);
const earlyDecisionOutput = runDecisionEngine(earlyDecisionInput);
const strategyContext: StrategyContext = {
  strategy: earlyDecisionOutput.strategy,
  stage: earlyDecisionOutput.stage,
  signals: earlyDecisionOutput.signals,
};
const llmResult = await tryLlmPlannerPipeline(input, priorMode, priorConfirmationPending, strategyContext);
```

---

### `packages/ai-engine/src/llm-pipeline.ts`

**新增參數**:
```typescript
export async function tryLlmPlannerPipeline(
  input: AiEngineInput,
  priorMode?: ConversationMode,
  priorConfirmationPending?: boolean,
  strategyContext?: StrategyContext,  // 新增
): Promise<...>
```

**策略驗證**:
```typescript
// DETAIL 和 INQUIRY 意圖時驗證 LLM 回應
const validation = validateLlmReply(llmReply, strategy);
if (!validation.valid) {
  console.log(`[LLM-PIPELINE] strategy_violation violations=${validation.violations.join('; ')}`);
}
```

---

### `packages/ai-engine/src/llm-prompt.ts`

**新增類型**:
```typescript
export interface StrategyContext {
  strategy: StrategyConfig;
  stage: ConversationStage;
  signals: CustomerSignals;
}
```

**系統提示增強**:
```typescript
export function buildLlmPlannerMessages(
  input: AiEngineInput,
  strategyContext?: StrategyContext,  // 新增
): { system: string; user: string }
```

當有 `strategyContext` 時，系統提示會包含：
- 階段指導
- 策略約束 (mustDo/forbidden)
- 客戶狀態摘要

---

### `packages/ai-engine/src/types.ts`

**擴展 DetectedSignals**:
```typescript
export interface DetectedSignals {
  // 原有欄位...

  // Decision Engine v1: 新增欄位
  conversationStage?: string;
  customerEmotion?: string;
  customerResistance?: string;
  customerReadiness?: number;
  customerTrust?: number;
  customerStyle?: string;
  strategy?: string;
  strategyMustDo?: string[];
  strategyForbidden?: string[];
}
```

---

### `apps/api/src/modules/chat/chat.service.ts`

**訊號加載與持久化**:
```typescript
// 加載上一輪的訊號
const {
  conversationStage,
  customerEmotion,
  customerResistance,
  customerReadiness,
  customerTrust,
  customerStyle,
} = conversationState;

// 傳遞給 AI Engine
signals: {
  conversationMode,
  confirmationPending,
  conversationStage,
  customerEmotion,
  // ...
}

// 日誌輸出
this.logger.log(
  `stage=${sig.conversationStage} emotion=${sig.customerEmotion} ` +
  `readiness=${sig.customerReadiness} strategy=${sig.strategy}`
);
```

---

### `apps/api/src/modules/chat/chat-persistence.service.ts`

**擴展 ConversationState**:
```typescript
export interface ConversationState {
  bookingDraft: BookingDraft | undefined;
  conversationMode: string;
  confirmationPending: boolean;
  // Decision Engine v1: 新增
  conversationStage?: string;
  customerEmotion?: string;
  customerResistance?: string;
  customerReadiness?: number;
  customerTrust?: number;
  customerStyle?: string;
}
```

---

### `apps/api/src/modules/conversations/conversations.service.ts`

**新增方法**:
```typescript
export interface ConversationSignals {
  conversationStage?: string;
  customerEmotion?: string;
  customerResistance?: string;
  customerReadiness?: number;
  customerTrust?: number;
  customerStyle?: string;
  strategy?: string;
  conversationMode?: string;
}

async getLatestSignals(conversationId: string): Promise<ConversationSignals>
```

---

### `apps/api/src/modules/conversations/conversations.controller.ts`

**API 端點增強**:
```typescript
@Get(':id')
async findById(@TenantId() tenantId: string, @Param('id') id: string) {
  const [conversation, signals] = await Promise.all([
    this.conversations.findByIdWithMessages(tenantId, id),
    this.conversations.getLatestSignals(id),
  ]);
  return { ...conversation, signals };
}
```

---

### `apps/web/app/(dashboard)/dashboard/conversations/[id]/page.tsx`

**新增 SignalsPanel 組件**:
- 顯示對話階段與模式
- 顯示當前策略
- 顯示客戶情緒、信任度、購買準備度
- 顯示阻力類型與溝通風格
- 信任度/準備度以進度條呈現

**UI 欄位**:
| 欄位 | 中文標籤 |
|------|----------|
| conversationStage | 階段 |
| conversationMode | 模式 |
| strategy | 策略 |
| customerEmotion | 情緒 |
| customerTrust | 信任度 |
| customerReadiness | 購買準備度 |
| customerResistance | 阻力 |
| customerStyle | 溝通風格 |

---

### `packages/ai-engine/src/index.ts`

**新增匯出**:
```typescript
// Decision Engine v1: Conversation Stage
export { detectStage, isValidStageTransition, getDefaultStageForMode, verifyConversationStageRegression, ... };

// Decision Engine v1: Customer Signals
export { detectCustomerSignals, summarizeSignals, verifyCustomerSignalsRegression, ... };

// Decision Engine v1: Strategy Selector
export { selectStrategy, summarizeStrategy, verifyStrategySelectorRegression, ... };

// Decision Engine v1: Response Components
export { selectComponentsForMustDo, getAlternativePhrasing, ... };

// Decision Engine v1: Main Engine
export { ConversationDecisionEngine, runDecisionEngine, ... };

// Decision Engine v1: LLM Strategy Guard
export { buildStrategyGuardPrompt, validateResponseAgainstStrategy, ... };

// Risk-based A/B testing
export { RISK_THRESHOLDS, getRiskLevel, getRiskModifier, assignExperimentGroup, shouldHandoffByRisk, ... };
```

---

## 測試

### 回歸測試

所有模組包含 `verify*Regression()` 函數：

```typescript
// conversation-stage.ts
verifyConversationStageRegression(): { ok: boolean; failures: string[] }

// customer-signals.ts
verifyCustomerSignalsRegression(): { ok: boolean; failures: string[] }

// strategy-selector.ts
verifyStrategySelectorRegression(): { ok: boolean; failures: string[] }

// risk-config.ts
verifyRiskConfigRegression(): { ok: boolean; failures: string[] }

// llm-strategy-guard.ts
verifyLlmStrategyGuardRegression(): { ok: boolean; failures: string[] }
```

### 測試場景

1. **情緒檢測**: 「我要投訴！」→ emotion='angry', shouldEscalate=true
2. **價格異議**: 「太貴了」→ strategy='present_value', mustDo=['acknowledge_price_concern']
3. **預約流程**: 「我想約星期三下午三點」→ stage='booking_slots', strategy='collect_slots'
4. **高風險**: riskScore=85 → shouldEscalate=true, experimentGroup='conservative'
5. **策略驗證**: LLM 回應包含「加購」→ containsForbidden=['upsell']

---

## 配置

### 風險閾值調整

編輯 `packages/ai-engine/src/risk-config.ts`:

```typescript
export const RISK_THRESHOLDS = {
  LOW: 30,      // 低風險上限
  MEDIUM: 50,   // 中風險上限
  HIGH: 70,     // 高風險上限
};
```

### 營業時間配置

在調用 `validateBookingRules()` 時傳入自定義配置：

```typescript
const customConfig: BusinessHoursConfig = {
  operatingDays: [1, 2, 3, 4, 5],  // 週一至週五
  openHour: 9,
  closeHour: 18,
  minLeadHours: 4,
  sameDayCutoffHour: 12,
};

const result = validateBookingRules(draft, customConfig);
```

---

## 日誌輸出範例

```
[ORCH] early_strategy=discover_need stage=discover
[ORCH] stage=discover strategy=discover_need emotion=calm readiness=2 trust=3
[LLM-PIPELINE] strategy_violation intent=DETAIL violations=containsForbidden: upsell
```

---

## 後續優化建議

1. **持久化 A/B Testing 結果** - 將實驗組分配存入資料庫以進行效果分析
2. **動態閾值調整** - 根據實際轉換率自動調整風險閾值
3. **多語言支援** - 擴展情緒檢測詞庫至英語/普通話
4. **效能監控** - 添加 Decision Engine 處理時間指標
5. **Dashboard 增強** - 添加歷史訊號趨勢圖表

---

## 相關文件

- `ADMIN_GUIDE.md` - 知識庫輸入規範
- `packages/ai-engine/src/types.ts` - 類型定義
- `packages/database/prisma/schema.prisma` - AiRun.signals 欄位

---

**維護者**: AI TOP SALES Team
**最後更新**: 2026-03-29