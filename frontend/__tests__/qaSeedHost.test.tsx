/**
 * QaSeedHost: the QA build's link listener (lib/qa/QaSeedHost.tsx).
 *
 * The bug class it guards: a cold start from the seed link. expo-router lands
 * the unknown path on +not-found, so the (tabs) layout (whose SQLiteProvider
 * initializes the database) never mounts unless the host navigates home, and a
 * link delivered before the navigator is ready must be HELD, not dropped or
 * run against a router that throws. runSeed itself is covered on real SQLite in
 * qaSeed.test.ts; here it is a mock so the test is about the host's wiring.
 */
import { act, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { router, useRootNavigationState } from 'expo-router';
import { QaSeedHost } from '@/lib/qa/QaSeedHost';
import { restoreFrozenClock, runSeed } from '@/lib/qa/runSeed';

jest.mock('expo-router', () => ({
  router: { dismissTo: jest.fn(), replace: jest.fn() },
  useRootNavigationState: jest.fn(),
}));
jest.mock('@/lib/qa/runSeed', () => ({
  runSeed: jest.fn(),
  restoreFrozenClock: jest.fn(),
}));

const SEED = 'myapp://qa/seed?scenario=week&now=2026-06-15T12:00:00Z';

let urlListener: ((e: { url: string }) => void) | null;
let navKey: string | undefined;

beforeEach(() => {
  jest.clearAllMocks();
  urlListener = null;
  navKey = 'root';
  (useRootNavigationState as jest.Mock).mockImplementation(() => (navKey ? { key: navKey } : undefined));
  (runSeed as jest.Mock).mockResolvedValue({ ok: true, scenario: 'week', entries: 10, now: '2026-06-15T12:00:00.000Z' });
  (restoreFrozenClock as jest.Mock).mockResolvedValue(null);
  jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(null);
  jest.spyOn(Linking, 'addEventListener').mockImplementation(((_: string, fn: (e: { url: string }) => void) => {
    urlListener = fn;
    return { remove: () => (urlListener = null) };
  }) as never);
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

const flush = () => act(async () => {});

it('renders nothing until a seed link arrives, and restores the frozen clock on mount', async () => {
  await render(<QaSeedHost />);
  await flush();
  expect(screen.queryByTestId('qa-seed-status')).toBeNull();
  expect(restoreFrozenClock).toHaveBeenCalledTimes(1);
});

it('a warm link: navigates home, seeds the parsed command, shows ok', async () => {
  await render(<QaSeedHost />);
  await flush();
  await act(async () => urlListener!({ url: SEED }));
  expect(router.dismissTo).toHaveBeenCalledWith('/');
  expect(runSeed).toHaveBeenCalledWith({ scenario: 'week', now: new Date('2026-06-15T12:00:00Z') });
  expect(screen.getByTestId('qa-seed-status')).toHaveTextContent('QA seed: ok week (10)');
});

it('a cold-start link is HELD until the navigator is ready, then runs once', async () => {
  navKey = undefined;
  (Linking.getInitialURL as jest.Mock).mockResolvedValue(SEED);
  const view = await render(<QaSeedHost />);
  await flush();
  expect(runSeed).not.toHaveBeenCalled();
  expect(router.dismissTo).not.toHaveBeenCalled();

  navKey = 'root';
  await view.rerender(<QaSeedHost />);
  await flush();
  expect(router.dismissTo).toHaveBeenCalledTimes(1);
  expect(runSeed).toHaveBeenCalledTimes(1);
});

it('falls back to replace when dismissTo throws (nothing to dismiss to)', async () => {
  (router.dismissTo as jest.Mock).mockImplementation(() => {
    throw new Error('no route');
  });
  await render(<QaSeedHost />);
  await flush();
  await act(async () => urlListener!({ url: SEED }));
  expect(router.replace).toHaveBeenCalledWith('/');
  expect(runSeed).toHaveBeenCalled();
});

it('ignores every other link (no navigation, no seed, no pill)', async () => {
  await render(<QaSeedHost />);
  await flush();
  await act(async () => urlListener!({ url: 'myapp://(tabs)/settings' }));
  expect(router.dismissTo).not.toHaveBeenCalled();
  expect(runSeed).not.toHaveBeenCalled();
  expect(screen.queryByTestId('qa-seed-status')).toBeNull();
});

it('a malformed seed link shows the error code and never seeds; the input is not echoed', async () => {
  await render(<QaSeedHost />);
  await flush();
  await act(async () => urlListener!({ url: 'myapp://qa/seed?scenario=nuke%3Cscript%3E' }));
  expect(runSeed).not.toHaveBeenCalled();
  expect(screen.getByTestId('qa-seed-status')).toHaveTextContent('QA seed: error unknown-scenario');
  const logged = (console.log as jest.Mock).mock.calls.flat().join(' ');
  expect(logged).not.toMatch(/nuke|script/);
});

it('a failed seed shows its error code', async () => {
  (runSeed as jest.Mock).mockResolvedValue({ ok: false, error: 'foreign-data' });
  await render(<QaSeedHost />);
  await flush();
  await act(async () => urlListener!({ url: SEED }));
  expect(screen.getByTestId('qa-seed-status')).toHaveTextContent('QA seed: error foreign-data');
});
