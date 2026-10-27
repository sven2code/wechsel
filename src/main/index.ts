import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, powerMonitor, screen, shell, Tray } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { systemClock, systemTimers } from '../core/clock';
import { AppController } from '../core/controller';
import { normalizeSettings } from '../core/settings';
import { ALLOWED_LINKS, IPC, type Command, type CommandResult } from '../shared/ipc';
import { DEFAULT_SETTINGS, type AppSnapshot, type ReminderView, type Settings } from '../shared/types';
import { Notifier } from './notifier';
import { debounced, JsonFile, Logger } from './storage';

const isMac = process.platform === 'darwin';
const IDLE_POLL_MS = 10_000;

// Nur Entwicklung: getrenntes Datenverzeichnis für Prüfläufe.
if (!app.isPackaged && process.env.WECHSEL_USER_DATA) app.setPath('userData', process.env.WECHSEL_USER_DATA);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let controller: AppController;
let notifier: Notifier;
let logger: Logger;
let tray: Tray | null = null;
let mainWin: BrowserWindow | null = null;
let reminderWin: BrowserWindow | null = null;
let reminderWinFor: string | null = null;
let quitting = false;
let lastAutostart: boolean | null = null;

const rendererUrl = (view: 'main' | 'reminder') => ({ file: join(__dirname, '../dist/renderer/index.html'), query: { view } });

// ---------- Fenster ----------

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 420,
    height: 700,
    minWidth: 380,
    minHeight: 560,
    show: false,
    title: 'Wechsel',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1f1e' : '#f6f5f2',
    autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  const u = rendererUrl('main');
  void mainWin.loadFile(u.file, { query: u.query });
  mainWin.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      mainWin?.hide();
    }
  });
  lockDownNavigation(mainWin);
}

function createReminderWindow() {
  reminderWin = new BrowserWindow({
    width: 380,
    height: 250,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1f1e' : '#f6f5f2',
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  const u = rendererUrl('reminder');
  void reminderWin.loadFile(u.file, { query: u.query });
  reminderWin.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      reminderWin?.hide();
    }
  });
  lockDownNavigation(reminderWin);
}

function lockDownNavigation(win: BrowserWindow) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function openApp(view: 'main' | 'settings' = 'main') {
  if (!mainWin) return;
  mainWin.show();
  mainWin.focus();
  if (isMac) app.focus({ steal: true });
  if (view === 'settings') mainWin.webContents.send(IPC.navigate, 'settings');
}

function showReminderWindow(view: ReminderView) {
  if (!reminderWin) return;
  // Hauptfenster im Vordergrund zeigt die Erinnerung bereits.
  if (mainWin?.isVisible() && mainWin.isFocused()) return;
  const area = screen.getPrimaryDisplay().workArea;
  const [w] = reminderWin.getSize();
  reminderWin.setPosition(area.x + area.width - w - 16, area.y + 16);
  reminderWinFor = view.id;
  pushState();
  reminderWin.showInactive(); // keinen Fokus stehlen
}

function hideReminderWindow() {
  reminderWinFor = null;
  reminderWin?.hide();
}

// ---------- Zustand an Oberfläche und Tray ----------

let pushQueued = false;
function pushState() {
  if (pushQueued) return;
  pushQueued = true;
  setTimeout(() => {
    pushQueued = false;
    const s = controller.snapshot();
    for (const w of [mainWin, reminderWin]) if (w && !w.isDestroyed()) w.webContents.send(IPC.state, s);
    updateTray(s);
  }, 50);
}

const phaseLabel: Record<AppSnapshot['phase'], string> = {
  sitting: 'Sitzen',
  standing: 'Stehen',
  movement: 'Bewegungspause',
  unknown: 'Phase unbekannt',
};

function statusLine(s: AppSnapshot) {
  if (s.motion.kind === 'countdown') return `Tisch fährt in ${s.motion.secondsLeft} s`;
  if (s.motion.kind === 'moving') return 'Tisch fährt …';
  if (s.hold === 'user') return 'Routine pausiert';
  if (s.hold) return 'Angehalten (abwesend)';
  if (s.outsideHours) return 'Außerhalb der Arbeitszeit';
  if (s.reminder) return s.reminder.title;
  const min = s.remainingMs !== null ? Math.ceil(s.remainingMs / 60_000) : null;
  return `${phaseLabel[s.phase]}${min !== null ? ` · nächster Vorschlag in ${min} min` : ''}${s.quiet ? ' · Ruhemodus' : ''}`;
}

let lastMenuKey = '';
function updateTray(s: AppSnapshot) {
  if (!tray) return;
  const line = statusLine(s);
  tray.setToolTip(`Wechsel – ${line}`);
  if (isMac) {
    const min = s.remainingMs !== null && s.running && !s.reminder ? `${Math.ceil(s.remainingMs / 60_000)} min` : '';
    const title = s.motion.kind !== 'idle' && s.motion.kind !== 'error' ? 'Fahrt' : s.reminder ? '•' : s.hold === 'user' ? 'Pause' : min;
    tray.setTitle(title ? ` ${title}` : '', { fontType: 'monospacedDigit' });
  }
  const key = JSON.stringify([line, s.phase, s.hold, s.quiet, s.motion.kind, s.desk.targetMoveReady.ok]);
  if (key === lastMenuKey) return;
  lastMenuKey = key;
  const send = (cmd: Command) => () => void handleCommand(cmd);
  const deskReady = s.desk.targetMoveReady.ok;
  const busy = s.motion.kind === 'countdown' || s.motion.kind === 'moving';
  const template: Electron.MenuItemConstructorOptions[] = [
    { label: line, enabled: false },
    { type: 'separator' },
    { label: 'Wechsel öffnen', click: () => openApp() },
  ];
  if (busy) template.push({ label: 'STOPP', click: send({ type: 'stopMotion' }) });
  template.push(
    { type: 'separator' },
    deskReady
      ? { label: 'Jetzt aufstehen (Tisch hochfahren)', enabled: !busy, click: () => (openApp(), void handleCommand({ type: 'requestMove', target: 'stand' })) }
      : { label: 'Ich stehe jetzt', click: send({ type: 'confirmPhase', phase: 'standing' }) },
    deskReady
      ? { label: 'Jetzt hinsetzen (Tisch herunterfahren)', enabled: !busy, click: () => (openApp(), void handleCommand({ type: 'requestMove', target: 'sit' })) }
      : { label: 'Ich sitze jetzt', click: send({ type: 'confirmPhase', phase: 'sitting' }) },
    { label: 'Bewegungspause starten', click: send({ type: 'startMovement' }) },
    { type: 'separator' },
    s.hold === 'user'
      ? { label: 'Routine fortsetzen', click: send({ type: 'resumeRoutine' }) }
      : { label: 'Routine pausieren', click: send({ type: 'pauseRoutine' }) },
    s.quiet
      ? { label: 'Ruhemodus beenden', click: send({ type: 'clearQuiet' }) }
      : {
          label: 'Ruhemodus (Meeting)',
          submenu: [
            { label: '30 Minuten', click: send({ type: 'setQuiet', minutes: 30 }) },
            { label: '60 Minuten', click: send({ type: 'setQuiet', minutes: 60 }) },
            { label: '2 Stunden', click: send({ type: 'setQuiet', minutes: 120 }) },
            { label: 'Bis ich ihn beende', click: send({ type: 'setQuiet', minutes: null }) },
          ],
        },
    { type: 'separator' },
    { label: 'Einstellungen …', click: () => openApp('settings') },
    { label: 'Wechsel beenden', click: () => app.quit() },
  );
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  const dir = join(__dirname, '../assets/generated');
  const img = isMac ? nativeImage.createFromPath(join(dir, 'trayTemplate.png')) : nativeImage.createFromPath(join(dir, 'tray-win.png'));
  if (isMac) img.setTemplateImage(true);
  tray = new Tray(img);
  if (!isMac) tray.on('click', () => (mainWin?.isVisible() ? mainWin.hide() : openApp()));
}

// ---------- Befehle aus der Oberfläche ----------

async function handleCommand(cmd: Command): Promise<CommandResult> {
  const c = controller;
  switch (cmd?.type) {
    case 'confirmPhase':
      if (cmd.phase !== 'sitting' && cmd.phase !== 'standing') break;
      c.confirmPhase(cmd.phase);
      return { ok: true };
    case 'reminderAction': {
      const r = c.reminderAction(String(cmd.reminderId), cmd.action, 'app');
      if (r.ok) hideReminderWindow();
      return r;
    }
    case 'requestMove':
      if (cmd.target !== 'sit' && cmd.target !== 'stand') break;
      return c.requestMove(cmd.target);
    case 'stopMotion':
      await c.stopMotion();
      return { ok: true };
    case 'dismissMotion':
      c.dismissMotion();
      return { ok: true };
    case 'holdStart':
      if (cmd.direction !== 'up' && cmd.direction !== 'down') break;
      return c.holdStart(cmd.direction);
    case 'holdHeartbeat':
      c.holdHeartbeat();
      return { ok: true };
    case 'holdEnd':
      await c.holdEnd();
      return { ok: true };
    case 'startMovement':
      c.startMovement();
      return { ok: true };
    case 'endMovement':
      c.endMovement();
      return { ok: true };
    case 'pauseRoutine':
      c.pauseRoutine();
      return { ok: true };
    case 'resumeRoutine':
      c.resumeRoutine();
      openApp();
      return { ok: true };
    case 'setQuiet':
      c.setQuiet(cmd.minutes === null ? null : Number(cmd.minutes));
      return { ok: true };
    case 'clearQuiet':
      c.clearQuiet();
      return { ok: true };
    case 'updateSettings':
      c.updateSettings(cmd.patch ?? {});
      return { ok: true };
    case 'captureHeight':
      return c.captureHeight(cmd.which === 'stand' ? 'stand' : 'sit');
    case 'connectDesk':
      return c.connectDesk();
    case 'disconnectDesk':
      await c.disconnectDesk();
      return { ok: true };
    case 'simulateHandsetMove':
      c.simulateHandsetMove(Number(cmd.mm));
      return { ok: true };
    case 'exportData':
      return exportData();
    case 'deleteData':
      return deleteData();
    case 'openLogs':
      await shell.openPath(join(app.getPath('userData'), 'logs'));
      return { ok: true };
    case 'openNotificationSettings':
      await shell.openExternal(isMac ? 'x-apple.systempreferences:com.apple.Notifications-Settings.extension' : 'ms-settings:notifications');
      return { ok: true };
    case 'testNotification':
      notifier.test();
      setTimeout(pushState, 1500);
      return { ok: true };
    case 'openLink':
      if (!ALLOWED_LINKS.includes(cmd.url)) break;
      await shell.openExternal(cmd.url);
      return { ok: true };
    case 'showMain':
      openApp();
      return { ok: true };
    case 'closeReminderWindow':
      hideReminderWindow();
      return { ok: true };
  }
  return { ok: false, reason: 'Unbekannter Befehl.' };
}

async function exportData(): Promise<CommandResult> {
  const res = await dialog.showSaveDialog(mainWin!, {
    title: 'Daten exportieren',
    defaultPath: `wechsel-export-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (res.canceled || !res.filePath) return { ok: false, reason: 'Abgebrochen.' };
  const data = {
    app: 'Wechsel',
    version: app.getVersion(),
    exportedAt: new Date().toISOString(),
    hinweis: 'Zeiten sind Schätzungen zwischen bestätigten Phasenwechseln, keine gemessene Körperhaltung.',
    settings: controller.getSettings(),
    stats: controller.stats.export(),
  };
  writeFileSync(res.filePath, JSON.stringify(data, null, 2), 'utf8');
  return { ok: true, message: 'Export gespeichert.' };
}

async function deleteData(): Promise<CommandResult> {
  const res = await dialog.showMessageBox(mainWin!, {
    type: 'warning',
    buttons: ['Abbrechen', 'Alles löschen'],
    defaultId: 0,
    cancelId: 0,
    message: 'Alle lokalen Daten löschen?',
    detail: 'Statistik, Protokolle und Einstellungen werden gelöscht und auf Standard zurückgesetzt.',
  });
  if (res.response !== 1) return { ok: false, reason: 'Abgebrochen.' };
  controller.clearStats();
  logger.clear();
  controller.updateSettings(DEFAULT_SETTINGS);
  logger.log('Lokale Daten gelöscht.');
  return { ok: true, message: 'Daten gelöscht.' };
}

function applySystemSettings(s: Settings) {
  nativeTheme.themeSource = s.appearance.theme;
  if (s.autostart !== lastAutostart) {
    lastAutostart = s.autostart;
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: s.autostart, args: isMac ? undefined : ['--hidden'] });
    else logger.log('Autostart wird nur in der gepackten App gesetzt.');
  }
}

// ---------- Start ----------

async function init() {
  if (isMac) app.dock?.hide(); // reine Menüleisten-App
  if (process.platform === 'win32') app.setAppUserModelId('de.svenhuelsemann.wechsel'); // nötig für Windows-Toasts
  const userData = app.getPath('userData');
  logger = new Logger(join(userData, 'logs'));
  const settingsFile = new JsonFile(join(userData, 'settings.json'));
  const statsFile = new JsonFile(join(userData, 'stats.json'));
  const settings = normalizeSettings(settingsFile.read());
  const firstRun = settingsFile.read() === undefined;
  const statsSaver = debounced(() => statsFile.write(controller.stats.export()), 30_000);
  logger.log(`Start (Version ${app.getVersion()}, ${process.platform}, gepackt: ${app.isPackaged}).`);

  notifier = new Notifier(
    (id, action) => {
      const r = controller.reminderAction(id, action, 'notification');
      if (!r.ok) logger.log(`Aktion aus Benachrichtigung abgelehnt: ${r.reason}`);
    },
    () => controller.reminderClicked(),
    (id) => {
      const pending = controller.engine.pending;
      if (pending?.id === id) showReminderWindow(controller.reminderView(pending));
      pushState();
    },
    (m) => logger.log(m),
  );

  createMainWindow();
  createReminderWindow();
  createTray();

  controller = new AppController(systemClock, systemTimers, settings, statsFile.read(), {
    showReminder: (view, { native }) => {
      const style = controller?.getSettings().notifications.style ?? settings.notifications.style;
      let nativeOk = false;
      if (native && style !== 'window') nativeOk = notifier.show(view);
      const nativeBroken = ['failed', 'unsupported'].includes(notifier.getStatus().status);
      if (native && (style !== 'native' || !nativeOk || nativeBroken)) showReminderWindow(view);
      pushState();
    },
    clearReminder: (id) => {
      notifier.close(id);
      if (reminderWinFor === id) hideReminderWindow();
    },
    openApp: () => openApp(),
    changed: () => pushState(),
    persistSettings: (s) => settingsFile.write(s),
    persistStats: () => statsSaver.schedule(),
    applySystemSettings,
    log: (m) => logger.log(m),
    notificationStatus: () => notifier.getStatus(),
    platform: process.platform,
    packaged: app.isPackaged,
  });
  applySystemSettings(settings);
  controller.start();

  // Systemereignisse
  powerMonitor.on('suspend', () => (logger.log('Ruhezustand.'), controller.suspend()));
  powerMonitor.on('resume', () => (logger.log('Aufgewacht.'), controller.resume()));
  powerMonitor.on('lock-screen', () => (logger.log('Bildschirm gesperrt.'), controller.lock()));
  powerMonitor.on('unlock-screen', () => (logger.log('Bildschirm entsperrt.'), controller.unlock()));
  // Nur die Leerlaufdauer in Sekunden – keine Eingaben oder Inhalte.
  setInterval(() => controller.idleSeconds(powerMonitor.getSystemIdleTime()), IDLE_POLL_MS);
  // Anzeige (Tray-Restzeit) auffrischen; Zeitmessung selbst hängt nicht daran.
  setInterval(pushState, 15_000);

  ipcMain.handle(IPC.snapshot, () => controller.snapshot());
  ipcMain.handle(IPC.command, (_e, cmd: Command) => handleCommand(cmd));

  app.on('before-quit', () => {
    quitting = true;
    controller.shutdown();
    statsSaver.flush();
    logger.log('Beendet.');
  });

  mainWin!.once('ready-to-show', () => {
    const atLogin = isMac ? app.getLoginItemSettings().wasOpenedAtLogin : process.argv.includes('--hidden');
    if (firstRun || !atLogin) {
      openApp();
      hideReminderWindow();
    }
  });
  pushState();
  if (!app.isPackaged && process.env.WECHSEL_SCREENSHOT_DIR) void devScreenshots(process.env.WECHSEL_SCREENSHOT_DIR);
}

/** Nur Entwicklung: Fenster als PNG ablegen, um die Oberfläche ohne Bildschirmaufnahme zu prüfen. */
async function devScreenshots(dir: string) {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const shot = async (win: BrowserWindow | null, name: string) => {
    if (!win) return;
    const img = await win.webContents.capturePage();
    writeFileSync(join(dir, `${name}.png`), img.toPNG());
  };
  await wait(2000);
  await shot(mainWin, 'main');
  const steps = (process.env.WECHSEL_SCREENSHOT_STEPS ?? '').split(',').filter(Boolean);
  for (const step of steps) {
    if (step === 'settings') {
      mainWin?.webContents.send(IPC.navigate, 'settings');
      await wait(600);
      await shot(mainWin, 'settings');
      mainWin?.webContents.send(IPC.navigate, 'main');
    } else if (step === 'reminderWindow') {
      const p = controller.engine.pending;
      if (p) showReminderWindow(controller.reminderView(p));
      await wait(800);
      await shot(reminderWin, 'reminder-window');
    } else if (step.startsWith('cmd:')) {
      await handleCommand(JSON.parse(step.slice(4).replace(/;/g, ',')));
    } else if (step.startsWith('wait:')) {
      await wait(Number(step.slice(5)));
    } else if (step.startsWith('shot:')) {
      await shot(mainWin, step.slice(5));
    }
  }
  if (process.env.WECHSEL_SCREENSHOT_QUIT) app.quit();
}

app.on('second-instance', () => openApp());
app.on('activate', () => openApp());
app.on('window-all-closed', () => {
  /* Läuft im Tray weiter */
});
void app.whenReady().then(init);
