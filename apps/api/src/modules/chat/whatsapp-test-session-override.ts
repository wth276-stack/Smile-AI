/**
 * Optional WhatsApp test sessions: "#test:<sessionKey> <message>" with env + allowlist.
 * See WHATSAPP_TEST_SESSION_ENABLED and WHATSAPP_TEST_SESSION_ALLOWLIST.
 *
 * When activated, `externalContactId` becomes `waId::sessionKey` so conversation/contact
 * state is isolated. ChatService also scopes upcoming-booking lookup to that contact only
 * (no phone-based cross-contact match), so prior #test:block* bookings do not leak.
 */
const WHATSAPP_TEST_PREFIX = /^#test:([A-Za-z0-9._-]+)\s+/;

export function parseTestSessionAllowlist(raw: string | undefined | null): string[] {
  if (raw == null || !String(raw).trim()) {
    return [];
  }
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function waDigits(s: string): string {
  return s.replace(/\D/g, '');
}

function isAllowlisted(allowlist: string[], waId: string): boolean {
  const id = waDigits(waId);
  if (!id) {
    return false;
  }
  for (const entry of allowlist) {
    if (waDigits(entry) === id) {
      return true;
    }
  }
  return false;
}

/**
 * @param enabled — WHATSAPP_TEST_SESSION_ENABLED === 'true'
 * @param allowlist — from WHATSAPP_TEST_SESSION_ALLOWLIST (comma-separated)
 */
export function parseWhatsappTestSession(
  waId: string,
  text: string,
  enabled: boolean,
  allowlist: string[],
): {
  externalContactId: string;
  messageText: string;
  sessionKey?: string;
  activated: boolean;
} {
  if (!enabled) {
    return { externalContactId: waId, messageText: text, activated: false };
  }
  if (!isAllowlisted(allowlist, waId)) {
    return { externalContactId: waId, messageText: text, activated: false };
  }
  const m = text.match(WHATSAPP_TEST_PREFIX);
  if (!m) {
    return { externalContactId: waId, messageText: text, activated: false };
  }
  const sessionKey = m[1];
  const messageText = text.slice(m[0].length).trim();
  return {
    externalContactId: `${waId}::${sessionKey}`,
    messageText,
    sessionKey,
    activated: true,
  };
}

/** Use real wa_id for phone auto-fill when externalContactId is "waId::sessionKey". */
export function baseWhatsappIdForPhone(externalContactId: string): string {
  const idx = externalContactId.indexOf('::');
  if (idx === -1) {
    return externalContactId;
  }
  return externalContactId.slice(0, idx);
}
