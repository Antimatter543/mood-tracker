/**
 * The mocked expo-sqlite database object. Import-free on purpose: the root
 * __mocks__/expo-sqlite.ts re-exports it, and testing/fakeDb.ts imports it
 * directly, so makeDb() works even in a suite that replaces expo-sqlite with
 * its own narrow jest.mock factory.
 */
export function createMockDatabase() {
    return {
        execAsync: jest.fn().mockResolvedValue(undefined),
        runAsync: jest.fn().mockResolvedValue({ lastInsertRowId: 1, changes: 1 }),
        getAllAsync: jest.fn().mockResolvedValue([]),
        getFirstAsync: jest.fn().mockResolvedValue(null),
        withTransactionAsync: jest.fn().mockImplementation(async (callback: () => Promise<void>) => {
            await callback();
        }),
        withExclusiveTransactionAsync: jest
            .fn()
            .mockImplementation(async (callback: () => Promise<void>) => {
                await callback();
            }),
    };
}
