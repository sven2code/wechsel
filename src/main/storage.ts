import { appendFileSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Lokale JSON-Dateien im App-Datenordner. Schreiben atomar über temporäre Datei. */
export class JsonFile {
  constructor(private path: string) {}

  read(): unknown {
    try {
      return JSON.parse(readFileSync(this.path, 'utf8'));
    } catch {
      return undefined;
    }
  }

  write(data: unknown) {
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    renameSync(tmp, this.path);
  }

  remove() {
    rmSync(this.path, { force: true });
  }
}

/** Gebündeltes, verzögertes Schreiben (z. B. Statistik bei jeder Sekunde). */
export function debounced(fn: () => void, ms: number) {
  let t: NodeJS.Timeout | null = null;
  const run = () => {
    t = null;
    fn();
  };
  return {
    schedule() {
      if (!t) t = setTimeout(run, ms);
    },
    flush() {
      if (t) {
        clearTimeout(t);
        run();
      }
    },
  };
}

const LOG_KEEP_DAYS = 7;

/**
 * Einfaches Tageslog. Enthält nur App-Ereignisse (Phasen, Fahrten, Fehler) –
 * keine Tastatureingaben, Fensterinhalte oder Geheimnisse.
 */
export class Logger {
  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true });
    this.prune();
  }

  log(message: string) {
    const now = new Date();
    const line = `${now.toISOString()} ${message.replace(/[\r\n]+/g, ' ')}\n`;
    try {
      appendFileSync(join(this.dir, `wechsel-${now.toISOString().slice(0, 10)}.log`), line, 'utf8');
    } catch {
      /* Logging darf die App nie stören */
    }
  }

  clear() {
    for (const f of readdirSync(this.dir)) if (f.endsWith('.log')) rmSync(join(this.dir, f), { force: true });
  }

  private prune() {
    const cutoff = new Date(Date.now() - LOG_KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
    for (const f of readdirSync(this.dir)) {
      const m = /^wechsel-(\d{4}-\d{2}-\d{2})\.log$/.exec(f);
      if (m && m[1] < cutoff) rmSync(join(this.dir, f), { force: true });
    }
  }
}
