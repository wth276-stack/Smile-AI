import type { ServiceMatchResult } from './types';

/**
 * Draft service fallback (PRICE / DETAIL_QUESTION only) — shared by rule orchestrator + LLM pipeline.
 */
export function allowsDraftServiceFallback(
  msg: string,
  intent: 'PRICE' | 'DETAIL_QUESTION',
  serviceMatch: ServiceMatchResult,
  serviceText: string,
): boolean {
  if (serviceMatch.type !== 'none') return false;
  const st = serviceText.trim();

  if (intent === 'PRICE') {
    if (st.length >= 2) return false;
    return isPriceContextOnlyMessage(msg);
  }

  if (st.length >= 2) {
    return isDetailOnlyFillerServiceText(st);
  }
  return isDetailContextOnlyMessage(msg);
}

function isPriceContextOnlyMessage(msg: string): boolean {
  const t = msg.trim().replace(/\s+/g, ' ');
  return (
    /^(唔該|請問|喂|pls)?\s*(咁|甘|那末|那么|那麼)?\s*(幾錢|几多钱|多少钱|多少錢|how\s*much|price|收幾多|收費點|收費如何)\s*[？?！!。…~～呀啊\d\s]*$/i.test(
      t,
    ) || /^(唔該|請問)?\s*幾錢\s*[？?！!。…~～呀啊]*$/i.test(t)
  );
}

function isDetailContextOnlyMessage(msg: string): boolean {
  const t = msg.trim();
  return /^(唔該|請問|喂)?\s*(有咩|有什麼|咩)(功效|效果|成份|成分|流程|步驟|過程)|^幾耐|^要幾耐|^做幾耐|^多長|^佢有咩功效|^details?\??$/i.test(
    t,
  );
}

function isDetailOnlyFillerServiceText(st: string): boolean {
  return (
    /^((有咩|有什麼|咩)\s*)?(功效|效果|成份|成分|過程|步驟|流程|時長|幾耐|要幾耐|做幾耐|多長|ingredient|duration|effect|procedure)/i.test(
      st,
    ) ||
    /^(功效|效果|成份|成分)(係|是|点|點|怎|點樣|如何)/i.test(st) ||
    /^佢有咩/i.test(st)
  );
}
