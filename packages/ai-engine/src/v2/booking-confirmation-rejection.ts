/**
 * User rejects the booking confirmation summary or wants to change a slot (not affirming submit).
 */
export function isBookingConfirmationRejectionMessage(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return /唔正確|唔啱|不對|唔係|想改|改時間|改日期|改名|改電話|打錯|應該係|換時間|換日期|唔係呢張|唔係呢個|不是這個|我唔取消|唔取消住|唔想取消|唔要取消|not\s*correct|incorrect|\bwrong\b|\bno\b/i.test(
    t,
  );
}
