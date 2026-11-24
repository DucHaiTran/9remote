// Installed-app names, one per build: W = web/PWA, A = the Android shell APK, L = the local dev
// server. Keeps the four installs on one phone apart. The APK names live in android-shell too.
const LOCAL = process.env.NODE_ENV === "development";
export const APP_NAME = LOCAL ? "9 Remote WL" : "9 Remote W";
export const SHELL_APP_NAME = LOCAL ? "9 Remote AL" : "9 Remote A";
const NAME_PREFIX = "9 Remote ";

// The build letter alone ("WL"), for tight spots like a header badge.
export function appVariant(name) {
  return name.startsWith(NAME_PREFIX) ? name.slice(NAME_PREFIX.length) : name;
}
