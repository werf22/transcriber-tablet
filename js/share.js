// share.js — page side of the share target: pick up files that sw.js stashed.
import { drain } from "./share-db.js";
import { log } from "./log.js";

export async function takeSharedFiles() {
  const url = new URL(location.href);
  if (!url.searchParams.has("shared")) return [];
  history.replaceState(null, "", url.pathname); // a reload must not re-import
  try {
    const files = await drain();
    log.info("Shared files received", { count: files.length });
    return files;
  } catch (e) {
    log.error("Could not read shared files", { error: e });
    return [];
  }
}
