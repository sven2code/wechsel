// Bündelt Hauptprozess und Preload für Electron.
import { build } from 'esbuild';

const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], sourcemap: true, logLevel: 'info' };
await build({ ...common, entryPoints: ['src/main/index.ts'], outfile: 'dist-electron/main.js' });
await build({ ...common, entryPoints: ['src/preload/index.ts'], outfile: 'dist-electron/preload.js' });
