import { describe, expect, it } from 'vitest';
import { replyHasConfirmationSummary } from './validator';

describe('replyHasConfirmationSummary', () => {
  it('detects Chinese numeral time (十點) in assistant summary-style text', () => {
    expect(
      replyHasConfirmationSummary(
        '幫你記低星期日十點，服務：Facial，請確認以上資料。',
      ),
    ).toBe(true);
  });

  it('does not treat bare user slot line as full summary', () => {
    expect(replyHasConfirmationSummary('Gigi，星期日十點')).toBe(false);
  });
});
