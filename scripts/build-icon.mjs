/**
 * Build Windows .ico (multi-size) from the master 1024px PNG.
 * Usage: node scripts/build-icon.mjs
 * Input:  build/icon-source.png   Output: build/icon.ico
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const SRC = path.resolve('build/icon-source.png');
const OUT = path.resolve('build/icon.ico');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

if (!fs.existsSync(SRC)) {
  console.error('Missing build/icon-source.png — generate the master icon first (1024x1024 PNG).');
  process.exit(1);
}

const buffers = [];
for (const size of SIZES) {
  const buf = await sharp(SRC)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  buffers.push(buf);
}
const ico = await pngToIco(buffers);
fs.writeFileSync(OUT, ico);
console.log(`Wrote ${OUT} with sizes: ${SIZES.join(', ')}px (${(ico.length / 1024).toFixed(1)} KB)`);
