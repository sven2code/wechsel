// Rendert assets/icon.svg mit Electron zu PNG und baut daraus icon.icns (macOS) bzw. icon.png (Windows).
// Aufruf: npx electron scripts/render-icon.mjs
import { app, BrowserWindow } from 'electron';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}assets/generated`;
mkdirSync(out, { recursive: true });

app.dock?.hide();
// Kein Top-Level-await: Electron meldet „ready“ erst nach dem Laden des Hauptmoduls.
void app.whenReady().then(async () => {
  const svg = readFileSync(`${root}assets/icon.svg`, 'utf8');
  const win = new BrowserWindow({ show: false, width: 1024, height: 1024, transparent: true, frame: false, webPreferences: { offscreen: true } });
  const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 500));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  const png = img.resize({ width: 1024, height: 1024, quality: 'best' }).toPNG();
  writeFileSync(`${out}/icon.png`, png);

  if (process.platform === 'darwin') {
    const set = `${out}/icon.iconset`;
    rmSync(set, { recursive: true, force: true });
    mkdirSync(set);
    for (const s of [16, 32, 128, 256, 512]) {
      execFileSync('sips', ['-z', String(s), String(s), `${out}/icon.png`, '--out', `${set}/icon_${s}x${s}.png`], { stdio: 'ignore' });
      execFileSync('sips', ['-z', String(s * 2), String(s * 2), `${out}/icon.png`, '--out', `${set}/icon_${s}x${s}@2x.png`], { stdio: 'ignore' });
    }
    execFileSync('iconutil', ['-c', 'icns', set, '-o', `${out}/icon.icns`]);
    rmSync(set, { recursive: true, force: true });
  }
  console.log('App-Icon erzeugt in assets/generated/');
  app.quit();
});
