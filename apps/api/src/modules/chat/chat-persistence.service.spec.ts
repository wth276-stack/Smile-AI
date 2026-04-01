import { verifyChatPersistenceRegression } from './chat-persistence.service';

describe('ChatPersistenceService regression helpers', () => {
  it('verifyChatPersistenceRegression passes', () => {
    const r = verifyChatPersistenceRegression();
    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
  });
});
