import { describe, expect, it } from 'vitest';
import { MIN, makeApp } from './helpers';

const pendingKind = (app: ReturnType<typeof makeApp>['app']) => app.engine.pending?.kind ?? null;

describe('Routine: Phasen nur nach Bestätigung', () => {
  it('fragt beim Start die Phase ab und zählt vorher keine Zeit', () => {
    const { app, clock } = makeApp();
    expect(app.engine.phase).toBe('unknown');
    expect(pendingKind(app)).toBe('confirmPhase');
    clock.advanceMinutes(45);
    expect(app.engine.currentPhaseActiveMs()).toBe(0);
    expect(app.stats.today(clock.wall()).sittingMs).toBe(0);
    expect(pendingKind(app)).toBe('confirmPhase'); // keine Erinnerungsschlange
  });

  it('schlägt nach 30 bestätigten Minuten Sitzen das Stehen vor – nicht früher', () => {
    const { app, clock, shown } = makeApp();
    app.confirmPhase('sitting');
    clock.advance(30 * MIN - 1000);
    expect(pendingKind(app)).toBeNull();
    clock.advance(1000);
    expect(pendingKind(app)).toBe('toStand');
    const last = shown.at(-1)!;
    expect(last.view.body).toBe('Möchtest du jetzt 5 Minuten im Stehen arbeiten?');
    expect(last.view.actions.map((a) => a.label)).toEqual(['Ich stehe jetzt', 'In 5 Minuten', 'Diesen Wechsel überspringen']);
    expect(last.native).toBe(true);
  });

  it('Stehphase endet nach 5 Minuten mit der Frage nach dem Hinsetzen', () => {
    const { app, clock, shown } = makeApp();
    app.confirmPhase('standing');
    clock.advanceMinutes(5);
    expect(pendingKind(app)).toBe('toSit');
    expect(shown.at(-1)!.view.actions.map((a) => a.label)).toEqual(['Ich sitze jetzt', '5 Minuten länger stehen', 'Routine pausieren']);
  });
});

describe('Routine: Snooze, Überspringen, Ignorieren', () => {
  it('Snooze verschiebt nur den Vorschlag und schreibt keine Stehzeit gut', () => {
    const { app, clock } = makeApp();
    app.confirmPhase('sitting');
    clock.advanceMinutes(30);
    const id = app.engine.pending!.id;
    expect(app.reminderAction(id, 'snooze', 'notification').ok).toBe(true);
    expect(app.engine.phase).toBe('sitting');
    clock.advance(5 * MIN - 1000);
    expect(pendingKind(app)).toBeNull();
    clock.advance(1000);
    expect(pendingKind(app)).toBe('toStand');
    const today = app.stats.today(clock.wall());
    expect(today.standingMs).toBe(0);
    expect(today.sittingMs).toBe(35 * MIN);
  });

  it('Überspringen lässt die Phase bestehen und plant frühestens nach dem Intervall neu', () => {
    const { app, clock } = makeApp({ routine: { movementEnabled: false } });
    app.confirmPhase('sitting');
    clock.advanceMinutes(30);
    app.reminderAction(app.engine.pending!.id, 'skip', 'app');
    expect(app.engine.phase).toBe('sitting');
    clock.advance(30 * MIN - 1000);
    expect(pendingKind(app)).toBeNull();
    clock.advance(1000);
    expect(pendingKind(app)).toBe('toStand');
  });

  it('fällige Bewegungspause hat Vorrang vor gleichzeitigem Wechselvorschlag', () => {
    const { app, clock } = makeApp();
    app.confirmPhase('sitting');
    clock.advanceMinutes(30);
    app.reminderAction(app.engine.pending!.id, 'skip', 'app');
    clock.advanceMinutes(30);
    expect(pendingKind(app)).toBe('movementBreak');
  });

  it('ignorierte Erinnerung läuft ab, bewegt nichts und erzeugt keine Schlange', () => {
    const { app, clock, cleared } = makeApp();
    app.confirmPhase('sitting');
    clock.advanceMinutes(30);
    const id = app.engine.pending!.id;
    clock.advanceMinutes(10);
    expect(cleared).toContain(id);
    expect(pendingKind(app)).toBeNull();
    expect(app.engine.phase).toBe('sitting');
    expect(app.stats.today(clock.wall()).ignored).toBe(1);
    // Alte Benachrichtigung wird später doch noch geklickt: wirkungslos.
    expect(app.reminderAction(id, 'confirmStanding', 'notification').ok).toBe(false);
    expect(app.engine.phase).toBe('sitting');
  });

  it('kürzere und längere Stehphasen sind einstellbar', () => {
    const { app, clock } = makeApp({ routine: { standMinutes: 2 } });
    app.confirmPhase('standing');
    clock.advanceMinutes(2);
    expect(pendingKind(app)).toBe('toSit');
    app.updateSettings({ routine: { standMinutes: 15 } });
    expect(app.getSettings().routine.standMinutes).toBe(15);
  });
});

describe('Routine: Bewegungspausen', () => {
  it('bietet stündlich eine Bewegungspause an und vermeidet direkte Doppel-Erinnerungen', () => {
    const { app, clock } = makeApp({ routine: { sitMinutes: 120 } });
    app.confirmPhase('sitting');
    clock.advanceMinutes(60);
    expect(pendingKind(app)).toBe('movementBreak');
    app.reminderAction(app.engine.pending!.id, 'startMovement', 'notification');
    expect(app.engine.phase).toBe('movement');
    clock.advanceMinutes(3);
    expect(pendingKind(app)).toBe('movementOver');
    // Zeit steht, bis die Phase bestätigt ist
    clock.advanceMinutes(20);
    app.reminderAction(app.engine.pending!.id, 'confirmSitting', 'app');
    clock.advanceMinutes(59);
    expect(pendingKind(app)).toBeNull();
    clock.advanceMinutes(1);
    expect(pendingKind(app)).toBe('movementBreak');
  });

  it('Bewegungspause über die Hauptansicht setzt den Bewegungstimer zurück', () => {
    const { app, clock } = makeApp({ routine: { sitMinutes: 120 } });
    app.confirmPhase('sitting');
    clock.advanceMinutes(55);
    app.startMovement();
    clock.advanceMinutes(3);
    app.reminderAction(app.engine.pending!.id, 'confirmSitting', 'app');
    clock.advanceMinutes(10);
    expect(pendingKind(app)).toBeNull();
  });

  it('Abwesenheit während der Bewegungspause pausiert nicht', () => {
    const { app } = makeApp();
    app.confirmPhase('sitting');
    app.startMovement();
    app.idleSeconds(600);
    expect(app.engine.hold).toBeNull();
  });
});

describe('Routine: Arbeitszeiten, Ruhemodus, Pause', () => {
  it('gibt außerhalb der Arbeitszeit keine Routinehinweise', () => {
    const { app, clock } = makeApp({}, new Date(2026, 9, 26, 17, 45));
    app.confirmPhase('sitting');
    clock.advanceMinutes(60); // 18:45
    expect(app.engine.outsideHours).toBe(true);
    expect(pendingKind(app)).toBeNull();
    clock.advanceMinutes(13 * 60 + 15); // Dienstag 08:00
    expect(app.engine.outsideHours).toBe(false);
    expect(pendingKind(app)).toBe('confirmPhase');
  });

  it('am Wochenende keine Hinweise (Standard Mo–Fr)', () => {
    const { app, clock } = makeApp({}, new Date(2026, 9, 31, 10, 0)); // Samstag
    expect(pendingKind(app)).toBeNull();
    clock.advanceMinutes(120);
    expect(pendingKind(app)).toBeNull();
  });

  it('Ruhemodus unterdrückt Vorschläge und gibt sie danach wieder frei', () => {
    const { app, clock } = makeApp();
    app.confirmPhase('sitting');
    app.setQuiet(45);
    clock.advanceMinutes(40);
    expect(pendingKind(app)).toBeNull();
    clock.advanceMinutes(5);
    expect(app.engine.quiet).toBe(false);
    expect(pendingKind(app)).toBe('toStand');
  });

  it('Pausieren friert die Zeit ein, Fortsetzen fragt die Phase neu ab', () => {
    const { app, clock } = makeApp();
    app.confirmPhase('sitting');
    clock.advanceMinutes(10);
    app.pauseRoutine();
    clock.advanceMinutes(60);
    expect(app.engine.currentPhaseActiveMs()).toBe(10 * MIN);
    expect(pendingKind(app)).toBeNull();
    app.resumeRoutine();
    expect(pendingKind(app)).toBe('confirmPhase');
  });
});

describe('Routine: Inaktivität, Ruhezustand, Systemzeit', () => {
  it('pausiert nach Inaktivität und fragt bei Rückkehr nach der Phase', () => {
    const { app, clock } = makeApp();
    app.confirmPhase('sitting');
    clock.advanceMinutes(10);
    app.idleSeconds(5 * 60);
    expect(app.engine.hold).toBe('idle');
    clock.advanceMinutes(90);
    expect(app.engine.currentPhaseActiveMs()).toBe(10 * MIN);
    expect(pendingKind(app)).toBeNull();
    app.idleSeconds(2);
    expect(app.engine.hold).toBeNull();
    expect(pendingKind(app)).toBe('confirmPhase');
    expect(app.engine.pending!.reason).toBe('idle');
  });

  it('Ruhezustand: keine nachgeholten Erinnerungen, Phase neu bestätigen', () => {
    const { app, clock, shown } = makeApp();
    app.confirmPhase('sitting');
    clock.advanceMinutes(20);
    app.suspend();
    const before = shown.length;
    clock.sleep(3 * 60 * MIN);
    app.resume();
    expect(shown.length).toBe(before + 1);
    expect(pendingKind(app)).toBe('confirmPhase');
  });

  it('Systemzeitänderung verlängert oder verkürzt keine Phase', () => {
    const { app, clock } = makeApp();
    app.confirmPhase('sitting');
    clock.advanceMinutes(10);
    clock.jumpWall(-30 * MIN); // Uhr zurückgestellt
    clock.advanceMinutes(1);
    // Sprung erkannt → Phase neu bestätigen; gemessene Dauer bleibt korrekt
    expect(pendingKind(app)).toBe('confirmPhase');
    expect(app.engine.currentPhaseActiveMs()).toBe(10 * MIN + 30_000);
  });

  it('kleine Wanduhr-Abweichungen lösen nichts aus und Restzeit bleibt monoton', () => {
    const { app, clock } = makeApp();
    app.confirmPhase('sitting');
    clock.advanceMinutes(10);
    clock.jumpWall(30_000);
    clock.advanceMinutes(1);
    expect(pendingKind(app)).toBeNull();
    expect(app.engine.next()!.remainingMs).toBe(19 * MIN);
  });
});
