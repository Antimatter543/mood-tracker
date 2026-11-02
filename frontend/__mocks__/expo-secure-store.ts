/**
 * In-memory expo-secure-store for jest (plain functions, see below). `__reset()` clears it between tests;
 * `__dump()` exposes raw stored values so tests can assert what is (and is
 * NOT, e.g. the password) persisted.
 */
let store = new Map<string, string>();

export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 'WHEN_UNLOCKED_THIS_DEVICE_ONLY';

// Plain functions, not jest.fn: suites that call jest.resetAllMocks() (e.g.
// data-export.test.ts) would otherwise wipe these implementations.
export const getItemAsync = async (key: string) => store.get(key) ?? null;
export const setItemAsync = async (key: string, value: string) => {
  store.set(key, value);
};
export const deleteItemAsync = async (key: string) => {
  store.delete(key);
};

export function __reset() {
  store = new Map();
}

export function __dump(): Record<string, string> {
  return Object.fromEntries(store);
}
