// Fork: a build without the Cargo feature `speech` has no Flow dictation, no
// Notetaker and no "OK Coucou", so the window hides their pages.

import { invoke } from "@tauri-apps/api/core";

/** Every page that needs speech: the Flow group and "OK Coucou". */
export const SPEECH_PAGES: ReadonlySet<string> = new Set([
  "dictation", "notes", "insights", "dictionary", "snippets", "styles", "flowsettings", "voice",
]);

/** Only an explicit `false` turns speech off; anything else keeps the original behaviour. */
export async function speechAvailable(): Promise<boolean> {
  return (await invoke<boolean>("speech_available").catch(() => null)) !== false;
}
