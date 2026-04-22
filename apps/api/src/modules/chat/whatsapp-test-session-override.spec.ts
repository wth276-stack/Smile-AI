import {
  baseWhatsappIdForPhone,
  parseTestSessionAllowlist,
  parseWhatsappTestSession,
} from './whatsapp-test-session-override';

describe('parseWhatsappTestSession', () => {
  const allowlist = ['85251805890', '85261234567'];

  it('enabled + allowlisted + valid prefix => activates and rewrites externalContactId/message', () => {
    const out = parseWhatsappTestSession(
      '85251805890',
      '#test:hifu1 我想預約HIFU',
      true,
      allowlist,
    );
    expect(out).toEqual({
      activated: true,
      sessionKey: 'hifu1',
      externalContactId: '85251805890::hifu1',
      messageText: '我想預約HIFU',
    });
  });

  it('facial example prefix', () => {
    const out = parseWhatsappTestSession(
      '85251805890',
      '#test:facial1 我想預約FACIAL',
      true,
      allowlist,
    );
    expect(out).toEqual({
      activated: true,
      sessionKey: 'facial1',
      externalContactId: '85251805890::facial1',
      messageText: '我想預約FACIAL',
    });
  });

  it('disabled => no rewrite', () => {
    const out = parseWhatsappTestSession(
      '85251805890',
      '#test:hifu1 我想預約HIFU',
      false,
      allowlist,
    );
    expect(out).toEqual({
      activated: false,
      externalContactId: '85251805890',
      messageText: '#test:hifu1 我想預約HIFU',
    });
  });

  it('not allowlisted => no rewrite', () => {
    const out = parseWhatsappTestSession(
      '99999999999',
      '#test:hifu1 我想預約HIFU',
      true,
      allowlist,
    );
    expect(out).toEqual({
      activated: false,
      externalContactId: '99999999999',
      messageText: '#test:hifu1 我想預約HIFU',
    });
  });

  it('malformed prefix => no rewrite', () => {
    const out = parseWhatsappTestSession('85251805890', '#test:onlykey', true, allowlist);
    expect(out).toEqual({
      activated: false,
      externalContactId: '85251805890',
      messageText: '#test:onlykey',
    });
  });

  it('normal message => no rewrite', () => {
    const out = parseWhatsappTestSession('85251805890', '我想預約HIFU', true, allowlist);
    expect(out).toEqual({
      activated: false,
      externalContactId: '85251805890',
      messageText: '我想預約HIFU',
    });
  });
});

describe('parseTestSessionAllowlist', () => {
  it('parses comma-separated ids with spaces', () => {
    expect(parseTestSessionAllowlist('85251805890, 85261234567')).toEqual([
      '85251805890',
      '85261234567',
    ]);
  });

  it('returns empty for empty or missing', () => {
    expect(parseTestSessionAllowlist(undefined)).toEqual([]);
    expect(parseTestSessionAllowlist('')).toEqual([]);
  });
});

describe('baseWhatsappIdForPhone', () => {
  it('returns first segment when composite', () => {
    expect(baseWhatsappIdForPhone('85251::hifu1')).toBe('85251');
  });

  it('returns full id when not composite', () => {
    expect(baseWhatsappIdForPhone('85251805890')).toBe('85251805890');
  });
});
