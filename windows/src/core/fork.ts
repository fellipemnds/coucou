// Fork: parts of the app built only with a Cargo feature (`speech`, `phone`).

import { invoke } from "@tauri-apps/api/core";

/** Only an explicit `false` turns a part off; anything else keeps the original behaviour. */
async function built(cmd: string): Promise<boolean> {
  return (await invoke<boolean>(cmd).catch(() => null)) !== false;
}

/** Flow dictation, the Notetaker and "OK Coucou". */
export const speechAvailable = () => built("speech_available");
/** The Android phone link. */
export const phoneAvailable = () => built("phone_available");
