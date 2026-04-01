// api-server/src/session.js
import db from './db.js';

// ---------- Prepared statements (reuse for performance) ----------

const stmts = {
  getSession:    db.prepare('SELECT * FROM sessions WHERE session_id = ?'),
  createSession: db.prepare('INSERT INTO sessions (session_id) VALUES (?)'),
  updateSlots:   db.prepare('UPDATE sessions SET slots = ?, updated_at = datetime(\'now\') WHERE session_id = ?'),

  getMessages:   db.prepare('SELECT role, content FROM messages WHERE session_id = ? ORDER BY id ASC'),
  addMessage:    db.prepare('INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)'),

  clearSession:  db.prepare('DELETE FROM messages WHERE session_id = ?'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE session_id = ?'),
};

// ---------- Session ----------

export function getSession(sessionId) {
  let row = stmts.getSession.get(sessionId);
  if (!row) {
    stmts.createSession.run(sessionId);
    row = stmts.getSession.get(sessionId);
  }
  return {
    sessionId: row.session_id,
    slots: JSON.parse(row.slots),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function updateSlots(sessionId, newSlots) {
  const session = getSession(sessionId);
  const merged = { ...session.slots, ...newSlots };
  stmts.updateSlots.run(JSON.stringify(merged), sessionId);
  return merged;
}

export function resetSession(sessionId) {
  stmts.clearSession.run(sessionId);
  stmts.updateSlots.run('{}', sessionId);
}

// ---------- Messages ----------

export function getMessages(sessionId) {
  return stmts.getMessages.all(sessionId);
}

export function addMessage(sessionId, role, content) {
  stmts.addMessage.run(sessionId, role, content);
}