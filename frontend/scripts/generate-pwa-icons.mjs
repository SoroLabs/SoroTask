/**
 * Generates the PWA icon set referenced by public/manifest.json.
 *
 * The manifest and app/layout.tsx both point at /icons/*.png, but those files
 * have never existed — every installable-PWA check and Lighthouse audit was
 * failing on 404s. Rather than committing opaque binaries with no provenance,
 * the artwork is defined here as raw pixel data and encoded on demand.
 *
 * Run with:  node scripts/generate-pwa-icons.mjs
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

// Brand ramp, matching --accent (#3b82f6) in app/globals.css.
const ACCENT = [59, 130, 246];
const ACCENT_DARK = [29, 78, 216];
const INK = [255, 255, 255];

/** CRC-32 as required by the PNG chunk format. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Encodes an RGBA pixel buffer as a PNG. */
function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // Each scanline is prefixed with filter type 0 (None).
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/**
 * Draws the mark: a rounded-square gradient tile with a "S" cut out of it.
 *
 * `maskable` versions inset the artwork into the safe zone (the inner 80% of
 * the canvas) because Android crops maskable icons to the device's mask.
 */
function drawIcon(size, { maskable = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const radius = maskable ? size * 0.5 : size * 0.22;
  const inset = maskable ? size * 0.14 : 0;
  const box = size - inset * 2;

  // The glyph occupies a smaller share of a maskable canvas.
  const glyphScale = maskable ? 0.62 : 0.78;
  const glyphCentre = size / 2;
  const stroke = size * (maskable ? 0.075 : 0.095);
  const glyphRadius = (box * glyphScale) / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;

      // Rounded-rect coverage, supersampled 3x3 for a smooth edge.
      let inside = 0;
      for (let sy = 0; sy < 3; sy++) {
        for (let sx = 0; sx < 3; sx++) {
          const px = x + (sx + 0.5) / 3;
          const py = y + (sy + 0.5) / 3;
          const dx = Math.max(inset + radius - px, px - (size - inset - radius), 0);
          const dy = Math.max(inset + radius - py, py - (size - inset - radius), 0);
          if (dx * dx + dy * dy <= radius * radius) inside++;
        }
      }
      if (inside === 0) continue;

      // Diagonal brand gradient.
      const t = (x + y) / (2 * size);
      let [r, g, b] = mix(ACCENT, ACCENT_DARK, t);

      // Glyph: a stroked S-curve sampled as two offset circles joined by a bar.
      const nx = x - glyphCentre;
      const ny = y - glyphCentre;
      const half = glyphRadius * 0.52;
      const topRing = Math.hypot(nx, ny + half) - glyphRadius * 0.55;
      const bottomRing = Math.hypot(nx, ny - half) - glyphRadius * 0.55;
      const onGlyph = Math.min(topRing, bottomRing) <= stroke / 2 && Math.abs(nx) <= glyphRadius * 0.5;

      if (onGlyph) {
        [r, g, b] = INK;
      }

      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = Math.round((inside / 9) * 255);
    }
  }

  return encodePng(size, size, rgba);
}

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  { file: "icon-192x192.png", size: 192 },
  { file: "icon-512x512.png", size: 512 },
  { file: "icon-maskable-512x512.png", size: 512, maskable: true },
  { file: "apple-touch-icon.png", size: 180 },
];

for (const { file, size, maskable } of targets) {
  const png = drawIcon(size, { maskable });
  writeFileSync(join(OUT_DIR, file), png);
  console.log(`${file} (${size}x${size}, ${png.length} bytes)`);
}
