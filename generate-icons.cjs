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
  const p = size / 192;

  // ── Background ──────────────────────────────────────────────
  const bgR = size * 0.22;
  ctx.fillStyle = '#fdf0eb';
  ctx.beginPath(); ctx.roundRect(0, 0, size, size, bgR); ctx.fill();
  ctx.strokeStyle = '#f2d5c8'; ctx.lineWidth = size * 0.025;
  ctx.beginPath(); ctx.roundRect(size*0.01, size*0.01, size*0.98, size*0.98, bgR); ctx.stroke();

  // ── Crying baby face (slightly right, behind mic) ────────────
  const fcx = 112 * p, fcy = 95 * p, fr = 62 * p;

  // Face
  ctx.fillStyle = '#fde8d8'; ctx.strokeStyle = '#e8956d'; ctx.lineWidth = 3 * p;
  ctx.beginPath(); ctx.arc(fcx, fcy, fr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

  // Rosy cheeks
  ctx.fillStyle = 'rgba(240,130,110,0.22)';
  ctx.beginPath(); ctx.ellipse(fcx - 38*p, fcy + 14*p, 20*p, 11*p, 0, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(fcx + 38*p, fcy + 14*p, 20*p, 11*p, 0, 0, Math.PI*2); ctx.fill();

  // Worried eyebrows (inner ends raised)
  ctx.strokeStyle = '#7a4f2e'; ctx.lineWidth = 3.5 * p; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(fcx - 34*p, fcy - 24*p); ctx.lineTo(fcx - 14*p, fcy - 32*p); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(fcx + 14*p, fcy - 32*p); ctx.lineTo(fcx + 34*p, fcy - 24*p); ctx.stroke();

  // Squinting crying eyes (arc curving downward = closed squint)
  ctx.strokeStyle = '#4a2c0a'; ctx.lineWidth = 3 * p;
  ctx.beginPath(); ctx.arc(fcx - 22*p, fcy - 8*p, 9*p, 0.15, Math.PI - 0.15); ctx.stroke();
  ctx.beginPath(); ctx.arc(fcx + 22*p, fcy - 8*p, 9*p, 0.15, Math.PI - 0.15); ctx.stroke();

  // Tear streaks
  ctx.fillStyle = '#89c4e1';
  ctx.beginPath(); ctx.ellipse(fcx - 22*p, fcy + 10*p, 4.5*p, 9*p, 0, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(fcx + 22*p, fcy + 10*p, 4.5*p, 9*p, 0, 0, Math.PI*2); ctx.fill();
  // teardrop points
  ctx.fillStyle = '#89c4e1';
  ctx.beginPath(); ctx.arc(fcx - 22*p, fcy + 21*p, 4*p, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(fcx + 22*p, fcy + 21*p, 4*p, 0, Math.PI*2); ctx.fill();

  // Open crying mouth
  ctx.fillStyle = '#b03020'; ctx.strokeStyle = '#7a1a0a'; ctx.lineWidth = 2.5 * p;
  ctx.beginPath(); ctx.ellipse(fcx, fcy + 36*p, 24*p, 15*p, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
  // upper lip line
  ctx.strokeStyle = '#e8956d'; ctx.lineWidth = 2 * p;
  ctx.beginPath(); ctx.arc(fcx, fcy + 22*p, 24*p, 0.15, Math.PI - 0.15); ctx.stroke();

  // ── Microphone (foreground, lower-left) ─────────────────────
  const mcx = 66 * p;

  // Drop shadow
  ctx.shadowColor = 'rgba(0,0,0,0.28)'; ctx.shadowBlur = 8*p; ctx.shadowOffsetX = 3*p; ctx.shadowOffsetY = 3*p;

  // Capsule
  const capX = mcx - 17*p, capY = 62*p, capW = 34*p, capH = 50*p, capR = 17*p;
  ctx.fillStyle = '#2c3e50';
  ctx.beginPath(); ctx.roundRect(capX, capY, capW, capH, capR); ctx.fill();

  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;

  ctx.strokeStyle = '#1a252f'; ctx.lineWidth = 2 * p;
  ctx.beginPath(); ctx.roundRect(capX, capY, capW, capH, capR); ctx.stroke();

  // Capsule grille lines
  ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1.8 * p; ctx.lineCap = 'round';
  [0.3, 0.52, 0.74].forEach(t => {
    const gy = capY + capH * t;
    const dy = Math.abs(gy - (capY + capH/2));
    const hw = Math.sqrt(Math.max(0, capR*capR - dy*dy)) - 2*p;
    ctx.beginPath(); ctx.moveTo(mcx - hw, gy); ctx.lineTo(mcx + hw, gy); ctx.stroke();
  });

  // Handle
  ctx.fillStyle = '#95a5a6'; ctx.strokeStyle = '#5d6d7e'; ctx.lineWidth = 2 * p;
  ctx.beginPath(); ctx.roundRect(mcx - 10*p, capY + capH - 2*p, 20*p, 24*p, 3*p); ctx.fill(); ctx.stroke();
  // Handle ring accent
  ctx.strokeStyle = '#7f8c8d'; ctx.lineWidth = 2 * p;
  ctx.beginPath(); ctx.moveTo(mcx - 10*p, capY + capH + 8*p); ctx.lineTo(mcx + 10*p, capY + capH + 8*p); ctx.stroke();

  // Stand — U-arc sweeping right
  ctx.strokeStyle = '#5d6d7e'; ctx.lineWidth = 3.5 * p; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(mcx + 14*p, capY + capH + 22*p, 14*p, Math.PI, Math.PI * 1.5);
  ctx.stroke();
  // Base
  ctx.beginPath();
  ctx.moveTo(mcx + 14*p, capY + capH + 22*p + 14*p);
  ctx.lineTo(mcx + 30*p, capY + capH + 22*p + 14*p);
  ctx.stroke();

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
