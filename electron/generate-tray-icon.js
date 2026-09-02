import fs from 'fs';
import path from 'path';

// Clean monochrome silhouette SVG for macOS Menu Bar Template Icon
const traySvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22" width="22" height="22">
  <!-- Clean Apple-style Lightning Bolt silhouette (zero background, 100% transparent) -->
  <path d="M12.5 2.5 L5.5 11.5 L10.5 11.5 L9.5 19.5 L16.5 10.5 L11.5 10.5 Z"
        fill="#000000" />
</svg>`;

const assetsDir = path.join(process.cwd(), 'electron/assets');
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

fs.writeFileSync(path.join(assetsDir, 'tray-icon.svg'), traySvg, 'utf-8');
console.log('Created tray-icon.svg');
