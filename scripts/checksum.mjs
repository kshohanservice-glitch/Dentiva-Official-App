/**
 * Produce SHA-256 checksums for release artifacts in dist/.
 * Usage: node scripts/checksum.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const dist = path.resolve('dist');
if (!fs.existsSync(dist)) {
  console.error('dist/ not found — build the release artifacts first.');
  process.exit(1);
}
const files = fs.readdirSync(dist).filter((f) => f.endsWith('.exe') || f.endsWith('.zip'));
if (!files.length) {
  console.error('No release artifacts (.exe/.zip) found in dist/.');
  process.exit(1);
}
const lines = [];
for (const f of files) {
  const buf = fs.readFileSync(path.join(dist, f));
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  lines.push(`${sha}  ${f}`);
  console.log(`${sha}  ${f}  (${(buf.length / 1048576).toFixed(1)} MB)`);
}
fs.writeFileSync(path.join(dist, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
console.log('Wrote dist/SHA256SUMS.txt');
