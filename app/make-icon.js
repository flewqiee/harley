// make-icon.js — assets/icon.png'den build/icon.ico üretir (16,24,32,48,64,128,256)
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const SRC = path.join(__dirname, 'assets', 'icon.png');
const OUT = path.join(__dirname, 'build', 'icon.ico');

const SIZES = [16, 24, 32, 48, 64, 128, 256];

function makeIco(entries) {
  // ICO header: 6 bytes (reserved=0, type=1, count)
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  // directory entries: 16 bytes each
  const dirSize = entries.length * 16;
  const offsets = [];
  let off = 6 + dirSize;
  const blobs = [];
  for (const e of entries) {
    const dir = Buffer.alloc(16);
    const size = e.size === 256 ? 0 : e.size;
    dir.writeUInt8(size, 0);
    dir.writeUInt8(size, 1);
    dir.writeUInt8(0, 2);
    dir.writeUInt8(0, 3);
    dir.writeUInt16LE(1, 4); // planes
    dir.writeUInt16LE(32, 6); // bpp
    dir.writeUInt32LE(e.png.length, 8); // bytes in resource
    dir.writeUInt32LE(off, 12); // offset
    offsets.push(dir);
    blobs.push(e.png);
    off += e.png.length;
  }
  return Buffer.concat([header, ...offsets, ...blobs]);
}

(async () => {
  const img = sharp(SRC).resize(256, 256, { fit: 'cover' });
  const entries = [];
  for (const s of SIZES) {
    const png = await sharp(SRC).resize(s, s, { fit: 'cover' }).png().toBuffer();
    entries.push({ size: s, png });
  }
  fs.writeFileSync(OUT, makeIco(entries));
  console.log('OK -> ' + OUT + ' (' + fs.statSync(OUT).size + ' bytes, ' + entries.length + ' boyut)');
})().catch((e) => { console.error(e); process.exit(1); });
