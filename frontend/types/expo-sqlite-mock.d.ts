// Augments expo-sqlite so the Jest auto-mock (__mocks__/expo-sqlite.ts) is visible
// to TypeScript. The trailing `export {}` makes this file a module, which is
// required for `declare module` to MERGE with the real package types rather
// than replace them.
declare module 'expo-sqlite' {
  export function createMockDatabase(): {
    execAsync: jest.Mock;
    runAsync: jest.Mock;
    getAllAsync: jest.Mock;
    getFirstAsync: jest.Mock;
    withTransactionAsync: jest.Mock;
    withExclusiveTransactionAsync: jest.Mock;
  };
}

export {};
