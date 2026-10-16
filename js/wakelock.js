// wakelock.js — keep the tablet screen on while uploads/transcriptions run.
// WHY: when the screen turns off Android freezes the app and a long upload
//      stalls. The lock is released as soon as nothing is running, and
//      re-acquired after the user comes back to the app (the OS drops it on hide).
import { log } from "./log.js";

export class WakeLock {
  constructor() {
    this.wanted = false;
    this.sentinel = null;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && this.wanted) this.acquire();
    });
  }
  async acquire() {
    if (!("wakeLock" in navigator) || this.sentinel) return;
    try {
      this.sentinel = await navigator.wakeLock.request("screen");
      this.sentinel.addEventListener("release", () => { this.sentinel = null; });
      log.info("Wake lock on");
    } catch (e) { log.warn("Wake lock refused", { error: e }); }
  }
  set(on) {
    this.wanted = on;
    if (on) this.acquire();
    else if (this.sentinel) { this.sentinel.release().catch(() => {}); this.sentinel = null; log.info("Wake lock off"); }
  }
}
