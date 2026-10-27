import type { ConnectionState, DeskCapabilities } from '../../shared/types';

/**
 * Kapselt einen Tisch. Nicht unterstützte Fähigkeiten werden über
 * `capabilities()` explizit als `false` gemeldet; die zugehörigen Methoden
 * werfen dann `UnsupportedError`.
 *
 * Ein echter Adapter darf nur entstehen, wenn Protokoll und Steuerungsweg
 * durch den Hersteller dokumentiert bzw. freigegeben und verifiziert sind.
 */
export interface DeskAdapter {
  readonly kind: 'simulator' | 'hardware';
  readonly label: string;
  capabilities(): DeskCapabilities;
  connection(): ConnectionState;
  connectionError(): string | null;
  /** Gerätegrenzen in mm, falls vom Gerät gemeldet. */
  limits(): { minMm: number; maxMm: number } | null;
  /** Aktuelle Höhe in mm – nur bei echter Rückmeldung, sonst null. */
  position(): number | null;
  /** Bewegt sich der Tisch laut Rückmeldung? null = unbekannt. */
  isMoving(): boolean | null;
  /** Erwartete Fahrgeschwindigkeit für die Timeout-Berechnung. */
  expectedSpeedMmPerS(): number | null;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  moveTo(targetMm: number): Promise<void>;
  startHold(direction: 'up' | 'down'): Promise<void>;
  endHold(): Promise<void>;
  stop(): Promise<void>;

  /** Benachrichtigt bei Änderungen an Verbindung, Position oder Bewegung. */
  onChange(fn: (e: AdapterEvent) => void): () => void;
  dispose(): void;
}

export type AdapterEvent =
  | { type: 'connection'; state: ConnectionState }
  | { type: 'position'; mm: number | null; moving: boolean | null }
  | { type: 'error'; message: string };

export class UnsupportedError extends Error {
  constructor(what: string) {
    super(`Nicht unterstützt: ${what}`);
  }
}
