import { describe, expect, it, vi } from 'vitest';
import { SimulatedDesk } from '../src/core/device/simulator';
import { MIN, SIM_READY, flush, makeApp, run } from './helpers';
import type { DeepPartial } from '../src/core/settings';
import type { Settings } from '../src/shared/types';

async function readyApp(extra: DeepPartial<Settings> = {}) {
  const ctx = makeApp({ ...SIM_READY, ...extra, desk: { ...SIM_READY.desk, ...(extra.desk ?? {}) } });
  const connecting = ctx.app.connectDesk();
  await run(ctx.clock, 400);
  await connecting;
  return ctx;
}

const spyMove = () => vi.spyOn(SimulatedDesk.prototype, 'moveTo');

describe('Fahrten: nur nach frischer Bestätigung', () => {
  it('manueller Modus bietet keine Fahrt an und lehnt Fahraktionen ab', () => {
    const { app, clock } = makeApp();
    app.confirmPhase('sitting');
    clock.advanceMinutes(30);
    const r = app.engine.pending!;
    expect(app.reminderView(r).actions.some((a) => a.id === 'deskUp')).toBe(false);
    expect(app.reminderAction(r.id, 'deskUp', 'notification').ok).toBe(false);
    expect(app.motion.busy).toBe(false);
  });

  it('Hochfahren: Klick → 5 s Countdown → Fahrt → Ankunft → Stehphase beginnt erst dann', async () => {
    const move = spyMove();
    const { app, clock, opened } = await readyApp();
    app.confirmPhase('sitting');
    clock.advanceMinutes(30);
    const r = app.engine.pending!;
    expect(app.reminderView(r).actions[0]).toMatchObject({ id: 'deskUp', label: 'Tisch hochfahren' });

    expect(app.reminderAction(r.id, 'deskUp', 'notification').ok).toBe(true);
    expect(opened()).toBe(1); // kompakte App geöffnet
    expect(app.motion.view().kind).toBe('countdown');
    // Doppelklick erzeugt keine zweite Fahrt
    expect(app.reminderAction(r.id, 'deskUp', 'notification').ok).toBe(false);
    expect(app.requestMove('stand').ok).toBe(false);

    await run(clock, 4900);
    expect(move).not.toHaveBeenCalled();
    await run(clock, 200);
    expect(move).toHaveBeenCalledTimes(1);
    expect(app.engine.phase).toBe('sitting'); // noch nicht angekommen

    await run(clock, 12_000); // 360 mm bei 35 mm/s
    expect(app.snapshot().desk.heightMm).toBe(1100);
    expect(app.engine.phase).toBe('standing');
    expect(app.engine.lastConfirmed!.source).toBe('deskArrival');
    expect(app.engine.pending).toBeNull();
    expect(move).toHaveBeenCalledTimes(1);
    move.mockRestore();
  });

  it('Herunterfahren nutzt denselben Bestätigungsablauf', async () => {
    const move = spyMove();
    const { app, clock } = await readyApp();
    app.confirmPhase('standing');
    clock.advanceMinutes(5);
    const r = app.engine.pending!;
    expect(app.reminderView(r).actions[0]).toMatchObject({ id: 'deskDown', label: 'Tisch herunterfahren' });
    app.reminderAction(r.id, 'deskDown', 'notification');
    expect(app.motion.view().kind).toBe('countdown');
    await run(clock, 4900);
    expect(move).not.toHaveBeenCalled();
    move.mockRestore();
  });

  it('Countdown lässt sich abbrechen – keine Fahrt, Erinnerung bleibt offen', async () => {
    const move = spyMove();
    const { app, clock } = await readyApp();
    app.confirmPhase('sitting');
    clock.advanceMinutes(30);
    const r = app.engine.pending!;
    app.reminderAction(r.id, 'deskUp', 'app');
    await run(clock, 2000);
    await app.stopMotion();
    await run(clock, 10_000);
    expect(move).not.toHaveBeenCalled();
    expect(app.engine.isPending(r.id)).toBe(true);
    move.mockRestore();
  });

  it('Snooze oder Ablauf während des Countdowns verhindern die Fahrt', async () => {
    const move = spyMove();
    const { app, clock } = await readyApp();
    app.confirmPhase('sitting');
    clock.advanceMinutes(30);
    const r = app.engine.pending!;
    app.reminderAction(r.id, 'deskUp', 'app');
    app.reminderAction(r.id, 'snooze', 'notification');
    await run(clock, 6000);
    expect(move).not.toHaveBeenCalled();
    expect(app.motion.view().kind).toBe('error');
    move.mockRestore();
  });

  it('Sperre während des Countdowns verwirft die Anfrage; nach Entsperren fährt nichts', async () => {
    const move = spyMove();
    const { app, clock } = await readyApp();
    app.confirmPhase('sitting');
    clock.advanceMinutes(30);
    app.reminderAction(app.engine.pending!.id, 'deskUp', 'notification');
    await run(clock, 1000);
    app.lock();
    expect(app.motion.view().kind).toBe('idle');
    await run(clock, 10_000);
    app.unlock();
    await run(clock, 10_000);
    expect(move).not.toHaveBeenCalled();
    expect(app.engine.pending!.kind).toBe('confirmPhase');
    move.mockRestore();
  });

  it('Ruhezustand während der Fahrt stoppt den Tisch und fährt danach nicht weiter', async () => {
    const { app, clock } = await readyApp();
    app.confirmPhase('sitting');
    app.requestMove('stand');
    await run(clock, 7000);
    expect(app.motion.view().kind).toBe('moving');
    app.suspend();
    await run(clock, 200);
    const h = app.snapshot().desk.heightMm!;
    expect(h).toBeGreaterThan(740);
    expect(h).toBeLessThan(1100);
    app.resume();
    await run(clock, 20_000);
    expect(app.snapshot().desk.heightMm).toBe(h);
    expect(app.motion.view()).toMatchObject({ kind: 'error', message: 'Fahrt abgebrochen: Ruhezustand.' });
    expect(app.stats.today(clock.wall()).deskMovesFailed).toBe(1);
  });

  it('ignorierte Erinnerung erzeugt nie einen Fahrbefehl', async () => {
    const move = spyMove();
    const { app, clock } = await readyApp();
    app.confirmPhase('sitting');
    clock.advanceMinutes(30);
    clock.advanceMinutes(15);
    await flush();
    expect(move).not.toHaveBeenCalled();
    move.mockRestore();
  });
});

describe('Fahrten: Validierung und Fähigkeiten', () => {
  it('ungültige Höhen sperren Zielfahrten', async () => {
    const { app } = await readyApp({ desk: { standMm: 780 } }); // < Sitz + 10 cm
    expect(app.motion.targetReadiness().ok).toBe(false);
    expect(app.requestMove('stand').ok).toBe(false);
    app.updateSettings({ desk: { standMm: 1400 } }); // über Gerätegrenze 1270
    expect(app.motion.targetReadiness().reasons.join(' ')).toMatch(/Gerätebereichs/);
    app.updateSettings({ desk: { standMm: 1100, personalMaxMm: 1050 } });
    expect(app.motion.targetReadiness().reasons.join(' ')).toMatch(/Höchsthöhe/);
  });

  it('ohne Sicherheitsbestätigung keine Fahrt', async () => {
    const { app } = await readyApp({ desk: { safetyAcknowledged: false } });
    expect(app.requestMove('stand').ok).toBe(false);
  });

  it('ohne zuverlässigen Stopp keine Zielfahrt und kein Gedrückthalten', async () => {
    const { app } = await readyApp({ desk: { simulator: { profile: 'noStop' } } as any });
    expect(app.motion.targetReadiness().ok).toBe(false);
    expect(app.motion.holdReadiness().ok).toBe(false);
  });

  it('ohne Telemetrie: Höhe unbekannt, keine Zielfahrt', async () => {
    const { app } = await readyApp({ desk: { simulator: { profile: 'noTelemetry' } } as any });
    const s = app.snapshot();
    expect(s.desk.heightMm).toBeNull();
    expect(s.desk.targetMoveReady.ok).toBe(false);
    expect(app.captureHeight('sit').ok).toBe(false);
  });

  it('nur Gedrückthalten: keine konstruierte Zielfahrt; Watchdog stoppt ohne Herzschlag', async () => {
    const { app, clock } = await readyApp({ desk: { simulator: { profile: 'holdOnly' } } as any });
    expect(app.motion.targetReadiness().ok).toBe(false);
    expect((await app.holdStart('up')).ok).toBe(true);
    await run(clock, 300);
    app.holdHeartbeat();
    await run(clock, 300);
    app.holdHeartbeat();
    await run(clock, 1000); // Herzschlag bleibt aus
    expect(app.motion.view().kind).toBe('idle');
    const h = app.snapshot().desk.heightMm!;
    await run(clock, 2000);
    expect(app.snapshot().desk.heightMm).toBe(h);
  });

  it('Höhe nur aus echter Rückmeldung übernehmen', async () => {
    const { app } = await readyApp();
    expect(app.captureHeight('sit').ok).toBe(true);
    expect(app.getSettings().desk.sitMm).toBe(740);
  });
});

describe('Stopp', () => {
  it('Stopp während der Fahrt hält den Tisch an und zählt nicht als Fehler', async () => {
    const { app, clock } = await readyApp();
    app.confirmPhase('sitting');
    app.requestMove('stand');
    await run(clock, 7000);
    await app.stopMotion();
    expect(app.motion.view().kind).toBe('idle');
    const h = app.snapshot().desk.heightMm!;
    await run(clock, 10_000);
    expect(app.snapshot().desk.heightMm).toBe(h);
    expect(app.stats.today(clock.wall()).deskMovesFailed).toBe(0);
    expect(app.engine.phase).toBe('sitting');
  });
});

describe('Fahrten: Fehlerfälle ohne automatische Wiederholung', () => {
  it('Verbindungsabbruch während der Fahrt: Fehler, kein Weiterfahren nach Wiederverbindung', async () => {
    const move = spyMove();
    const { app, clock } = await readyApp({ desk: { simulator: { failure: 'disconnectDuringMove' } } as any });
    app.confirmPhase('sitting');
    app.requestMove('stand');
    await run(clock, 8000);
    expect(app.motion.view()).toMatchObject({ kind: 'error' });
    expect(app.snapshot().desk.connection).toBe('error');
    const p = app.connectDesk();
    await run(clock, 500);
    await p;
    const h = app.snapshot().desk.heightMm!;
    await run(clock, 15_000);
    expect(app.snapshot().desk.heightMm).toBe(h);
    expect(move).toHaveBeenCalledTimes(1);
    expect(app.engine.phase).toBe('sitting'); // keine erfundene Ankunft
    move.mockRestore();
  });

  it('Blockade: Timeout, Stopp wird gesendet, Fehler angezeigt, kein zweiter Versuch', async () => {
    const move = spyMove();
    const stop = vi.spyOn(SimulatedDesk.prototype, 'stop');
    const { app, clock } = await readyApp({ desk: { simulator: { failure: 'stall' } } as any });
    app.confirmPhase('sitting');
    app.requestMove('stand');
    await run(clock, 40_000);
    expect(app.motion.view().kind).toBe('error');
    expect(stop).toHaveBeenCalled();
    expect(move).toHaveBeenCalledTimes(1);
    expect(app.engine.phase).toBe('sitting');
    expect(app.stats.today(clock.wall()).deskMovesFailed).toBe(1);
    move.mockRestore();
    stop.mockRestore();
  });

  it('Stopp nicht bestätigt: ehrliche Fehlermeldung', async () => {
    const { app, clock } = await readyApp({ desk: { simulator: { failure: 'stopIgnored' } } as any });
    app.confirmPhase('sitting');
    app.requestMove('stand');
    await run(clock, 6000);
    await app.stopMotion();
    expect(app.motion.view()).toMatchObject({ kind: 'error' });
    expect((app.motion.view() as any).message).toMatch(/Bedienteil/);
  });

  it('Verbindungsfehler beim Verbinden wird angezeigt, Routine läuft weiter', async () => {
    const ctx = makeApp({ ...SIM_READY, desk: { ...SIM_READY.desk, simulator: { failure: 'connectFails' } } as any });
    const p = ctx.app.connectDesk();
    await run(ctx.clock, 500);
    expect((await p).ok).toBe(false);
    ctx.app.confirmPhase('sitting');
    ctx.clock.advanceMinutes(30);
    expect(ctx.app.engine.pending!.kind).toBe('toStand');
    expect(ctx.app.reminderView(ctx.app.engine.pending!).actions[0].id).toBe('confirmStanding');
  });
});

describe('Manuelle Tischbewegung', () => {
  it('erkennt Bedienteil-Fahrt, fragt nach, ändert die Phase aber nicht selbst', async () => {
    const { app, clock } = await readyApp();
    app.confirmPhase('sitting');
    clock.advanceMinutes(3);
    app.simulateHandsetMove(1100);
    await run(clock, 12_000);
    expect(app.engine.phase).toBe('sitting');
    expect(app.engine.pending!.kind).toBe('confirmPhase');
    expect(app.engine.pending!.reason).toBe('manualMove');
    expect(app.snapshot().desk.manualMoveDetected).toBe(true);
  });

  it('eine App-Fahrt gilt nicht als manuelle Bewegung', async () => {
    const { app, clock } = await readyApp();
    app.confirmPhase('sitting');
    app.requestMove('stand');
    await run(clock, 20_000);
    expect(app.engine.phase).toBe('standing');
    expect(app.engine.pending).toBeNull();
    expect(app.snapshot().desk.manualMoveDetected).toBe(false);
    void MIN;
  });
});
