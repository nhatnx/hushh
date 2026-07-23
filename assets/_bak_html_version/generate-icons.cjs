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

  // Background
  ctx.fillStyle = '#fdf0eb';
  const r = size * 0.22;
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, r);
  ctx.fill();

  // Subtle border
  ctx.strokeStyle = '#f2d5c8';
  ctx.lineWidth = size * 0.02;
  ctx.beginPath();
  ctx.roundRect(size*0.01, size*0.01, size*0.98, size*0.98, r);
  ctx.stroke();

  // Baby bottle emoji (drawn as text)
  ctx.font = `${size * 0.55}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🍼', size / 2, size / 2);

  return canvas.toBuffer('image/png');
}

const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir);

[192, 512].forEach(size => {
  const buf = generateIcon(size);
  const outPath = path.join(iconsDir, `icon-${size}.png`);
  fs.writeFileSync(outPath, buf);
  console.log(`Generated ${outPath}`);
});

console.log('Icons generated successfully!');
