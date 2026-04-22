import { shouldEscapeStaleConfirmation } from './stale-confirmation-escape';

describe('shouldEscapeStaleConfirmation', () => {
  it('true for FAQ while pending (modify state preserved in chat.service, not here)', () => {
    expect(shouldEscapeStaleConfirmation('HIFU 療程幾多錢？')).toBe(true);
  });

  it('false for clear modify/cancel wording', () => {
    expect(shouldEscapeStaleConfirmation('我想改時間')).toBe(false);
  });
});
