#!/usr/bin/env node
/* generate-icons.js
   Generates PWA icons using Canvas API (Node.js with canvas package)
   Run: npm install canvas && node generate-icons.js
*/

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

function generateIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const p = size / 192; // scale all coords from a 192-unit grid

  // ── Background ──────────────────────────────────────────────
  const bgR = size * 0.22;
  ctx.fillStyle = '#fdf0eb';
  ctx.beginPath(); ctx.roundRect(0, 0, size, size, bgR); ctx.fill();
  ctx.strokeStyle = '#f2d5c8'; ctx.lineWidth = size * 0.025;
  ctx.beginPath(); ctx.roundRect(size*0.01, size*0.01, size*0.98, size*0.98, bgR); ctx.stroke();

  // ── Baby bottle (drawn on a 192×192 grid, scaled by p) ──────
  //   Layout (y from top):
  //     nipple  : 18–52  (34px tall, 30px wide, centered)
  //     collar  : 48–60  (12px tall, 52px wide, centered)
  //     neck    : 56–88  (32px tall, 40px wide, centered)
  //     shoulder: 84–106 (22px tall, transitions body width)
  //     body    : 100–170 (70px tall, 86px wide, centered)

  const stroke = '#c96b47';
  ctx.lineJoin = 'round';

  // Body
  const bx = 53 * p, by = 100 * p, bw = 86 * p, bh = 70 * p, br = 18 * p;
  ctx.fillStyle = '#ffffff'; ctx.strokeStyle = stroke; ctx.lineWidth = 3.5 * p;
  ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, br); ctx.fill(); ctx.stroke();

  // Milk fill (lower 55% of body, same rounded bottom)
  const fillTop = by + bh * 0.43;
  ctx.save();
  ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, br); ctx.clip();
  ctx.fillStyle = '#f9e4c8';
  ctx.fillRect(bx, fillTop, bw, bh - (fillTop - by));
  ctx.restore();
  // redraw body outline on top
  ctx.strokeStyle = stroke; ctx.lineWidth = 3.5 * p;
  ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, br); ctx.stroke();

  // Graduation marks on right side of body
  ctx.strokeStyle = '#e8a87c'; ctx.lineWidth = 2 * p;
  [0.28, 0.50, 0.72].forEach((frac, i) => {
    const y = by + bh * frac;
    const len = i === 1 ? 14 * p : 9 * p;
    ctx.beginPath();
    ctx.moveTo(bx + bw - 6 * p - len, y);
    ctx.lineTo(bx + bw - 6 * p, y);
    ctx.stroke();
  });

  // Shoulder (trapezoid bridging neck→body)
  const nx = 76 * p, nw = 40 * p;
  ctx.fillStyle = '#ffffff'; ctx.strokeStyle = stroke; ctx.lineWidth = 3.5 * p;
  ctx.beginPath();
  ctx.moveTo(nx, 88 * p);
  ctx.lineTo(nx + nw, 88 * p);
  ctx.lineTo(bx + bw, by + br);
  ctx.lineTo(bx, by + br);
  ctx.closePath(); ctx.fill();
  // side strokes only (top + bottom already covered by neck/body outlines)
  ctx.beginPath();
  ctx.moveTo(nx, 88 * p); ctx.lineTo(bx, by + br);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(nx + nw, 88 * p); ctx.lineTo(bx + bw, by + br);
  ctx.stroke();

  // Neck
  const nr = 7 * p;
  ctx.fillStyle = '#ffffff'; ctx.strokeStyle = stroke; ctx.lineWidth = 3.5 * p;
  ctx.beginPath(); ctx.roundRect(nx, 56 * p, nw, 36 * p, [nr, nr, 0, 0]); ctx.fill(); ctx.stroke();

  // Collar ring
  ctx.fillStyle = '#f2a58e'; ctx.strokeStyle = stroke; ctx.lineWidth = 2.5 * p;
  ctx.beginPath(); ctx.roundRect(70 * p, 48 * p, 52 * p, 14 * p, 4 * p); ctx.fill(); ctx.stroke();

  // Nipple
  ctx.fillStyle = '#f2a58e'; ctx.strokeStyle = stroke; ctx.lineWidth = 3 * p;
  ctx.beginPath(); ctx.roundRect(81 * p, 18 * p, 30 * p, 36 * p, [15 * p, 15 * p, 4 * p, 4 * p]); ctx.fill(); ctx.stroke();

  return canvas.toBuffer('image/png');
}

const iconsDir = path.join(__dirname, 'public', 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

[192, 512].forEach(size => {
  const buf = generateIcon(size);
  const outPath = path.join(iconsDir, `icon-${size}.png`);
  fs.writeFileSync(outPath, buf);
  console.log(`Generated ${outPath}`);
});

// favicon.ico — ICO container wrapping the 192x192 PNG (width/height = 0 means 256 in the
// ICO spec, which browsers interpret as "use full size"). PNG-in-ICO is supported by all
// modern browsers and avoids needing canvas to resize to 32x32.
function generateFavicon() {
  const png = generateIcon(192);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry.writeUInt8(0, 0);            // width  — 0 means 256 (ICO spec)
  entry.writeUInt8(0, 1);            // height — 0 means 256
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);
  fs.writeFileSync(path.join(__dirname, 'public', 'favicon.ico'), Buffer.concat([header, entry, png]));
  console.log('Generated public/favicon.ico');
}

generateFavicon();
console.log('Icons generated successfully!');
