// Fork: a build without the Cargo feature `speech` has no Flow dictation, no
// Notetaker and no "OK Coucou", so the window hides their pages.

/** Every page that needs speech: the Flow group and "OK Coucou". */
export const SPEECH_PAGES: ReadonlySet<string> = new Set([
  "dictation", "notes", "insights", "dictionary", "snippets", "styles", "flowsettings", "voice",
]);
