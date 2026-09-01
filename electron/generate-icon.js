import fs from 'fs';
import path from 'path';

// Generate a valid 32x32 and 256x256 PNG tray/app icon
// We can use a simple SVG converted to PNG or direct PNG buffer
const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#3b82f6" />
      <stop offset="50%" stop-color="#10b981" />
      <stop offset="100%" stop-color="#06b6d4" />
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="6" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
  </defs>
  <rect width="256" height="256" rx="64" fill="#0f172a" />
  <rect x="8" y="8" width="240" height="240" rx="56" fill="none" stroke="url(#grad)" stroke-width="4" opacity="0.6" />
  
  <!-- Central Lightning & Hub Symbol -->
  <path d="M140 28 L64 144 L124 144 L116 228 L192 112 L132 112 Z" fill="url(#grad)" filter="url(#glow)" />
  
  <!-- Pulse circles -->
  <circle cx="64" cy="64" r="8" fill="#10b981" opacity="0.8" />
  <circle cx="192" cy="192" r="8" fill="#3b82f6" opacity="0.8" />
  <circle cx="192" cy="64" r="6" fill="#06b6d4" opacity="0.8" />
  <circle cx="64" cy="192" r="6" fill="#10b981" opacity="0.8" />
</svg>`;

fs.writeFileSync(path.join(process.cwd(), 'electron/assets/icon.svg'), svgIcon, 'utf-8');
console.log('Generated icon.svg');
