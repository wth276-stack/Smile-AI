/**
 * Post-build check: confirm ai-engine dist contains KB prompt changes (not apps/api dist — Nest keeps workspace deps external).
 * Usage: node scripts/verify-kb-prompt-bundle.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const promptJs = path.join(root, 'packages/ai-engine/dist/v2/prompt.js');

if (!fs.existsSync(promptJs)) {
  console.error('Missing:', promptJs, '→ run: pnpm --filter @ats/ai-engine build');
  process.exit(1);
}

const st = fs.statSync(promptJs);
const text = fs.readFileSync(promptJs, 'utf8');

const checks = [
  ['packages/ai-engine/dist/v2/prompt.js mtime', st.mtime.toISOString()],
  ['contains "Package includes (原文"', text.includes('Package includes (原文')],
  ['contains "KB effect duration"', text.includes('KB effect duration')],
  ['contains FAQ verbatim / formatFaqBlock', /formatFaqBlock|FAQ \(verbatim/.test(text)],
  ['contains 精準事實 (system rules)', text.includes('精準事實')],
];

console.log('KB prompt bundle verification\n');
for (const [k, v] of checks) {
  if (typeof v === 'boolean') {
    console.log(v ? '✓' : '✗', k);
    if (!v) process.exitCode = 1;
  } else {
    console.log(' ', k + ':', v);
  }
}

console.log(
  '\nNote: apps/api/dist does not inline @ats/ai-engine. At runtime Node resolves workspace/symlinked node_modules/@ats/ai-engine/dist.',
);
console.log('Railway: ensure deploy runs pnpm install + build for @ats/ai-engine before api start.\n');
