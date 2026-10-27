import type { WechselApi } from '../shared/ipc';

declare global {
  interface Window {
    wechsel: WechselApi;
  }
}
