/**
 * Stricter price cue detection for smoke tests: require currency marker + amount,
 * or amount + 元/港元/港幣. Avoids false passes from bare digits (e.g. 60分鐘、14日、1次).
 */
export function replyAppearsToQuotePrice(reply: string): boolean {
  const s = reply;
  return (
    /(?:HKD|HK\$|\$)\s*\d[\d,]*(?:\.\d+)?/i.test(s) ||
    /\d[\d,]*(?:\.\d+)?\s*(?:元|港元|港幣)/.test(s)
  );
}
