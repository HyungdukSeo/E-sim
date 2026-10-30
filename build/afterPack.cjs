// electron-builder afterPack hook (macOS only).
//
// Without an Apple Developer ID we cannot notarize, but we can still give the
// bundle a complete ad-hoc signature. electron-builder skips signing entirely
// when no identity is configured, which leaves the .app with only a
// linker-signed main binary and no sealed resources — Gatekeeper then reports
// the downloaded app as "damaged" and the only way out is `xattr -cr`.
//
// A full ad-hoc signature over every nested Mach-O (frameworks, helpers,
// native modules) plus the outer bundle turns that into the regular
// "unidentified developer" prompt, which users can bypass with right-click →
// Open (or 시스템 설정 → 개인정보 보호 및 보안 → 그래도 열기) and no terminal.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function codesign(target, extraArgs = []) {
  execFileSync('codesign', ['--force', '--sign', '-', '--timestamp=none', ...extraArgs, target], {
    stdio: ['ignore', 'ignore', 'inherit']
  });
}

function isMachO(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    const magic = buf.readUInt32BE(0);
    // MH_MAGIC_64 / MH_CIGAM_64 / FAT_MAGIC / FAT_CIGAM
    return magic === 0xfeedfacf || magic === 0xcffaedfe || magic === 0xcafebabe || magic === 0xbebafeca;
  } catch {
    return false;
  }
}

// Sign inside-out: nested bundles (.framework/.app/.xpc) and loose Mach-O files
// first, then the enclosing bundle, so every outer seal covers already-signed
// children.
function signTree(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (/\.(framework|app|xpc|appex|bundle|plugin)$/.test(entry.name)) {
        signTree(full);
        codesign(full);
      } else {
        signTree(full);
      }
    } else if (entry.isFile() && isMachO(full)) {
      codesign(full);
    }
  }
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  if (!fs.existsSync(appPath)) {
    console.warn(`[afterPack] app bundle not found: ${appPath}`);
    return;
  }

  console.log(`[afterPack] ad-hoc signing ${appPath}`);
  signTree(path.join(appPath, 'Contents'));
  codesign(appPath);

  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=1', appPath], { stdio: 'inherit' });
  console.log('[afterPack] ad-hoc signature verified');
};
