/** Returns current date/time aligned to Asia/Hong_Kong calendar day. */
export function getHKTToday(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Hong_Kong' }));
}
