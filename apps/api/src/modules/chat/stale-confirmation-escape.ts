/**
 * Stale booking-confirmation escape (FAQ / info queries while confirmationPending).
 * isConfirmationMessage is the single source of truth from @ats/ai-engine (v2/validator).
 */
import { isConfirmationMessage } from '@ats/ai-engine';

export { isConfirmationMessage };

const PRICE_OR_INFO_REDIRECT = /幾錢|價錢|價格|how much|收費|想知道.*價|想問.*價|只係想知|只想問|只係想了解|營業|地址|幾耐|副作用|係咩|有咩|邊度/i;

/**
 * Modification / cancel / correction related to the pending booking — do NOT escape.
 * If the user mixes "唔正確" with a clear price/FAQ ask, treat as FAQ (not modify-only).
 */
export function isModifyOrCancelIntent(msg: string): boolean {
  const t = msg.trim();
  if (!t) return false;

  if (PRICE_OR_INFO_REDIRECT.test(t) && !/改時間|改日期|改做|換.*時間|換.*日期|想改.*點|改為.*點/.test(t)) {
    return false;
  }

  if (/cancel|取消預約|唔要預約|唔book|算啦|唔好意思.*取消|唔做|唔預約/i.test(t)) return true;
  if (/改時間|改日期|改做|想改|要改|換時間|換日期|wrong|change|modify|想改做|改為|改成/i.test(t)) return true;
  if (/電話打錯|名打錯|名寫錯|電話寫錯|應該係|打錯咗/i.test(t)) return true;
  if (/唔正確|唔啱|錯咗|錯了|唔係.*資料|資料.*唔啱/.test(t)) return true;

  return false;
}

export function isFaqOrInfoQuery(msg: string): boolean {
  const t = msg.trim();
  if (!t) return false;

  if (/幾錢|價錢|價格|how much|收費|\bfee\b|\bcost\b|\bprice\b/i.test(t)) return true;
  if (/係咩|有咩|營業時間|開幾點|幾點關|邊度|地址|location|有冇副作用|做幾耐|適合|禁忌|效果|原理/i.test(t)) return true;
  if (/^(你好|喂|hi|hello|您好|早晨|午安|晚安|bye|拜拜|再見|多謝|thanks|thank you)[!！。.]?$/i.test(t)) return true;
  if (/[?？]/.test(t) && /(幾|什麼|咩|邊|點|點樣|是否|會唔會|有冇|可以|可唔可以|邊個)/.test(t)) return true;

  return false;
}

export function shouldEscapeStaleConfirmation(message: string): boolean {
  if (isConfirmationMessage(message)) return false;
  if (isModifyOrCancelIntent(message)) return false;
  return isFaqOrInfoQuery(message);
}
