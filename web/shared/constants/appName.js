// Installed-app name: the local dev server gets its own, so its PWA is not mixed up with the released one.
export const APP_NAME = process.env.NODE_ENV === "development" ? "9 Remote WL" : "9 Remote W";
