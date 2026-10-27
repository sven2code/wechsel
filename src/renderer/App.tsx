import { useEffect, useState } from 'react';
import type { Command } from '../shared/ipc';
import type { AppSnapshot } from '../shared/types';
import { MainView } from './MainView';
import { ReminderWindow } from './ReminderWindow';
import { SettingsView } from './SettingsView';

const windowKind = new URLSearchParams(location.search).get('view') === 'reminder' ? 'reminder' : 'main';

export interface Ctx {
  s: AppSnapshot;
  /** Zeitpunkt (performance.now) des Snapshots – für die lokale Restzeitanzeige. */
  receivedAt: number;
  send: (cmd: Command) => Promise<void>;
  error: string | null;
  clearError: () => void;
}

export function App() {
  const [snap, setSnap] = useState<{ s: AppSnapshot; at: number } | null>(null);
  const [view, setView] = useState<'main' | 'settings'>('main');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const api = window.wechsel;
    void api.snapshot().then((s) => setSnap({ s, at: performance.now() }));
    const off1 = api.onState((s) => setSnap({ s, at: performance.now() }));
    const off2 = api.onNavigate((v) => setView(v));
    return () => {
      off1();
      off2();
    };
  }, []);

  useEffect(() => {
    if (!snap) return;
    const t = snap.s.settings.appearance.theme;
    document.documentElement.dataset.theme = t;
    document.documentElement.dataset.platform = snap.s.platform;
  }, [snap?.s.settings.appearance.theme, snap?.s.platform]);

  if (!snap) return null;

  const send = async (cmd: Command) => {
    const r = await window.wechsel.send(cmd);
    if (!r.ok && r.reason !== 'Abgebrochen.') setError(r.reason);
    else setError(null);
  };
  const ctx: Ctx = { s: snap.s, receivedAt: snap.at, send, error, clearError: () => setError(null) };

  if (windowKind === 'reminder') return <ReminderWindow {...ctx} />;
  return view === 'settings' ? <SettingsView {...ctx} onBack={() => setView('main')} /> : <MainView {...ctx} onSettings={() => setView('settings')} />;
}

/** Sekundentakt nur für die Anzeige. Die Zeitmessung liegt im Hauptprozess. */
export function useTick(active: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => set((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
}
