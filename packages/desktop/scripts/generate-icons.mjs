#!/usr/bin/env node
/**
 * Generate placeholder icons for the ABF Desktop app.
 *
 * Creates all icon files referenced in tauri.conf.json:
 *   - icons/32x32.png
 *   - icons/128x128.png
 *   - icons/128x128@2x.png  (256×256)
 *   - icons/icon.png         (512×512 — tray icon source)
 *   - icons/icon.ico          (multi-size ICO)
 *   - icons/icon.icns         (macOS ICNS container)
 *
 * Uses pure Node.js (zlib for PNG deflate). No external dependencies.
 * Replace these with real branding when ready.
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = join(__dirname, '..', 'src-tauri', 'icons');

// ── CRC-32 (required by PNG format) ──────────────────────────────────────────

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ── PNG generation ───────────────────────────────────────────────────────────

function makeChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);

  const crcInput = Buffer.concat([typeBuffer, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput));

  return Buffer.concat([length, typeBuffer, data, crcBuf]);
}

function createPNG(size) {
  // Generate RGBA pixel data with a diagonal gradient (#3b82f6 → #8b5cf6)
  // matching the ABF brand colors from the splash screen
  const rowBytes = 1 + size * 4; // filter byte + RGBA per pixel
  const raw = Buffer.alloc(size * rowBytes);

  const cornerRadius = Math.round(size * 0.18);

  for (let y = 0; y < size; y++) {
    const rowOff = y * rowBytes;
    raw[rowOff] = 0; // filter: None

    for (let x = 0; x < size; x++) {
      const t = (x + y) / (2 * size);
      const r = Math.round(59 + (139 - 59) * t);
      const g = Math.round(130 + (92 - 130) * t);
      const b = 246;
      let a = 255;

      // Rounded corners — set alpha to 0 outside the radius
      const cx = x < cornerRadius ? cornerRadius - x : x >= size - cornerRadius ? x - (size - cornerRadius - 1) : 0;
      const cy = y < cornerRadius ? cornerRadius - y : y >= size - cornerRadius ? y - (size - cornerRadius - 1) : 0;
      if (cx > 0 && cy > 0) {
        const dist = Math.sqrt(cx * cx + cy * cy);
        if (dist > cornerRadius) {
          a = 0;
        } else if (dist > cornerRadius - 1.5) {
          a = Math.round(255 * (cornerRadius - dist) / 1.5); // anti-alias
        }
      }

      const off = rowOff + 1 + x * 4;
      raw[off] = r;
      raw[off + 1] = g;
      raw[off + 2] = b;
      raw[off + 3] = a;
    }
  }

  const compressed = deflateSync(raw, { level: 9 });

  // PNG signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    sig,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── ICO generation (multi-size container with embedded PNGs) ─────────────────

function createICO(pngBuffers) {
  // ICO header: 6 bytes
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);                   // reserved
  header.writeUInt16LE(1, 2);                   // type: ICO
  header.writeUInt16LE(pngBuffers.length, 4);   // image count

  // Directory entries: 16 bytes each
  const dirSize = 16 * pngBuffers.length;
  let dataOffset = 6 + dirSize;

  const entries = [];
  for (const { size, data } of pngBuffers) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;   // width (0 = 256)
    entry[1] = size >= 256 ? 0 : size;   // height
    entry[2] = 0;                         // color palette
    entry[3] = 0;                         // reserved
    entry.writeUInt16LE(1, 4);            // color planes
    entry.writeUInt16LE(32, 6);           // bits per pixel
    entry.writeUInt32LE(data.length, 8);  // image data size
    entry.writeUInt32LE(dataOffset, 12);  // offset to data
    entries.push(entry);
    dataOffset += data.length;
  }

  return Buffer.concat([
    header,
    ...entries,
    ...pngBuffers.map(b => b.data),
  ]);
}

// ── ICNS generation (macOS icon container with embedded PNGs) ────────────────

function createICNS(pngBuffers) {
  // ICNS maps specific sizes to 4-byte type codes
  const typeMap = {
    16: 'icp4',   // 16×16
    32: 'icp5',   // 32×32
    64: 'icp6',   // 64×64
    128: 'ic07',  // 128×128
    256: 'ic08',  // 256×256
    512: 'ic09',  // 512×512
    1024: 'ic10', // 1024×1024
  };

  const entries = [];
  for (const { size, data } of pngBuffers) {
    const type = typeMap[size];
    if (!type) continue;

    const entrySize = 8 + data.length;
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, 'ascii');
    header.writeUInt32BE(entrySize, 4);
    entries.push(Buffer.concat([header, data]));
  }

  const totalSize = 8 + entries.reduce((sum, e) => sum + e.length, 0);
  const fileHeader = Buffer.alloc(8);
  fileHeader.write('icns', 0, 4, 'ascii');
  fileHeader.writeUInt32BE(totalSize, 4);

  return Buffer.concat([fileHeader, ...entries]);
}

// ── Main ─────────────────────────────────────────────────────────────────────

mkdirSync(ICONS_DIR, { recursive: true });

// Generate PNGs at all needed sizes
const sizes = [16, 32, 64, 128, 256, 512, 1024];
const pngs = sizes.map(size => ({ size, data: createPNG(size) }));

// Write individual PNGs
writeFileSync(join(ICONS_DIR, '32x32.png'), pngs.find(p => p.size === 32).data);
writeFileSync(join(ICONS_DIR, '128x128.png'), pngs.find(p => p.size === 128).data);
writeFileSync(join(ICONS_DIR, '128x128@2x.png'), pngs.find(p => p.size === 256).data);
writeFileSync(join(ICONS_DIR, 'icon.png'), pngs.find(p => p.size === 512).data);

// Write ICO (16, 32, 64, 128, 256)
const icoSizes = pngs.filter(p => p.size <= 256);
writeFileSync(join(ICONS_DIR, 'icon.ico'), createICO(icoSizes));

// Write ICNS (all sizes)
writeFileSync(join(ICONS_DIR, 'icon.icns'), createICNS(pngs));

console.log('Generated placeholder icons in', ICONS_DIR);
sizes.forEach(s => {
  const png = pngs.find(p => p.size === s);
  console.log(`  ${s}×${s}: ${png.data.length} bytes`);
});
