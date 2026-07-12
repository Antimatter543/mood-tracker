/**
 * Unit tests for the write-transaction primitive (databases/writeTransaction.ts).
 *
 * Uses a bespoke expo-sqlite mock whose `openDatabaseAsync` returns a RECORDING
 * connection that logs every statement in order — so we can assert the exact
 * BEGIN/COMMIT/PRAGMA sequencing, rollback-on-error, and that two concurrent
 * transactions serialize on the in-process mutex (no interleaved statements).
 */

// `mock`-prefixed so the hoisted jest.mock factory may reference it.
const mockState: { conn: any; log: string[] } = { conn: null, log: [] };
const mockOpen = jest.fn(async (..._args: any[]) => mockState.conn);

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: (...args: any[]) => mockOpen(...args),
}));

import {
  withWriteTransaction,
  withWriteLock,
  DATABASE_NAME,
  __resetWriteTransactionForTests,
} from '@/databases/writeTransaction';

/** A connection that appends `kind:sql` to the shared log for every statement. */
function makeConn() {
  const record = (kind: string) => (sql: string) => {
    mockState.log.push(`${kind}:${String(sql).trim()}`);
    return Promise.resolve(kind === 'run' ? { lastInsertRowId: 1, changes: 1 } : undefined);
  };
  return {
    execAsync: jest.fn(record('exec')),
    runAsync: jest.fn(record('run')),
    getAllAsync: jest.fn(() => Promise.resolve([])),
    getFirstAsync: jest.fn(() => Promise.resolve(null)),
  };
}

const upper = (s: string) => s.toUpperCase();
const idxOf = (needle: string) =>
  mockState.log.findIndex((l) => upper(l).includes(needle));

beforeEach(() => {
  __resetWriteTransactionForTests();
  mockState.conn = makeConn();
  mockState.log = [];
  mockOpen.mockClear();
});

describe('write connection setup', () => {
  it('opens ONE connection with useNewConnection, sets busy_timeout + FK ON BEFORE any BEGIN', async () => {
    await withWriteTransaction(async () => {});

    expect(mockOpen).toHaveBeenCalledTimes(1);
    expect(mockOpen).toHaveBeenCalledWith(DATABASE_NAME, { useNewConnection: true });

    const busy = idxOf('BUSY_TIMEOUT');
    const fk = idxOf('FOREIGN_KEYS = ON');
    const begin = idxOf('BEGIN IMMEDIATE');
    expect(busy).toBeGreaterThanOrEqual(0);
    expect(fk).toBeGreaterThanOrEqual(0);
    expect(begin).toBeGreaterThanOrEqual(0);
    // PRAGMAs must precede BEGIN — FK/busy_timeout are per-connection and a PRAGMA
    // is a no-op inside a transaction.
    expect(busy).toBeLessThan(begin);
    expect(fk).toBeLessThan(begin);
  });

  it('opens the connection only ONCE across multiple transactions (singleton)', async () => {
    await withWriteTransaction(async () => {});
    await withWriteTransaction(async () => {});
    expect(mockOpen).toHaveBeenCalledTimes(1);
  });
});

describe('transaction sequencing', () => {
  it('runs BEGIN IMMEDIATE, then the task, then COMMIT', async () => {
    await withWriteTransaction(async (txn) => {
      await txn.runAsync('INSERT INTO t VALUES (1)');
    });

    const seq = mockState.log.filter((l) => /BEGIN IMMEDIATE|run:INSERT|COMMIT/i.test(l));
    expect(upper(seq[0])).toContain('BEGIN IMMEDIATE');
    expect(seq[1]).toContain('run:INSERT');
    expect(upper(seq[2])).toContain('COMMIT');
  });

  it('hands the opened write connection to the task (txn === the write connection)', async () => {
    let received: unknown;
    await withWriteTransaction(async (txn) => {
      received = txn;
    });
    expect(received).toBe(mockState.conn);
  });

  it('returns the task result', async () => {
    const out = await withWriteTransaction(async () => 42);
    expect(out).toBe(42);
  });
});

describe('rollback on error', () => {
  it('ROLLBACKs and rethrows when the task throws (no COMMIT)', async () => {
    const boom = new Error('task boom');
    await expect(
      withWriteTransaction(async () => {
        throw boom;
      })
    ).rejects.toBe(boom);

    expect(mockState.log.some((l) => upper(l).includes('ROLLBACK'))).toBe(true);
    expect(mockState.log.some((l) => upper(l).includes('COMMIT'))).toBe(false);
  });

  it('a failed write inside the task rolls the whole transaction back', async () => {
    mockState.conn.runAsync.mockRejectedValueOnce(new Error('constraint failed'));
    await expect(
      withWriteTransaction(async (txn) => {
        await txn.runAsync('INSERT INTO t VALUES (1)');
      })
    ).rejects.toThrow('constraint failed');
    expect(mockState.log.some((l) => upper(l).includes('ROLLBACK'))).toBe(true);
  });
});

describe('mutex serialization', () => {
  it('serializes two concurrent transactions — one completes before the other starts', async () => {
    const order: string[] = [];
    const p1 = withWriteTransaction(async (txn) => {
      order.push('A-start');
      await txn.runAsync('A');
      order.push('A-end');
    });
    const p2 = withWriteTransaction(async (txn) => {
      order.push('B-start');
      await txn.runAsync('B');
      order.push('B-end');
    });
    await Promise.all([p1, p2]);

    // A must fully finish before B begins (mutex) — never interleaved.
    expect(order).toEqual(['A-start', 'A-end', 'B-start', 'B-end']);

    // The statement log shows two clean BEGIN..COMMIT blocks in sequence.
    const txns = mockState.log
      .filter((l) => /BEGIN IMMEDIATE|COMMIT/i.test(l))
      .map((l) => (upper(l).includes('BEGIN') ? 'BEGIN' : 'COMMIT'));
    expect(txns).toEqual(['BEGIN', 'COMMIT', 'BEGIN', 'COMMIT']);
  });

  it('a failed transaction still releases the mutex for the next one', async () => {
    await expect(
      withWriteTransaction(async () => {
        throw new Error('first fails');
      })
    ).rejects.toThrow('first fails');

    // The next write must not be wedged behind the failed one.
    const out = await withWriteTransaction(async () => 'ok');
    expect(out).toBe('ok');
  });
});

describe('withWriteLock (the mutex primitive)', () => {
  it('hands the connection to the task WITHOUT opening a transaction', async () => {
    await withWriteLock(async (conn) => {
      await conn.execAsync('PRAGMA foreign_keys = OFF;');
    });
    // No BEGIN/COMMIT is issued by withWriteLock itself — the caller owns those.
    expect(mockState.log.some((l) => upper(l).includes('BEGIN'))).toBe(false);
    expect(mockState.log.some((l) => upper(l).includes('FOREIGN_KEYS = OFF'))).toBe(true);
  });
});
