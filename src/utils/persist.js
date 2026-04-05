function emitStorageChange(key, value, removed = false) {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent('pocketcode:storagechange', {
      detail: { key, value, removed },
    }));
  } catch (_) {}
}

export function readJson(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

export function writeJson(key, value) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    emitStorageChange(key, value, false);
  } catch (_) {}
}

export function readText(key, fallback = '') {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ?? fallback;
  } catch (_) {
    return fallback;
  }
}

export function writeText(key, value) {
  if (typeof window === 'undefined') return;
  try {
    const normalized = String(value ?? '');
    window.localStorage.setItem(key, normalized);
    emitStorageChange(key, normalized, false);
  } catch (_) {}
}

export function removeItem(key) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
    emitStorageChange(key, undefined, true);
  } catch (_) {}
}

export function getStorage() {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}
