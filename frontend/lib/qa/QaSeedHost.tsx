import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { router, useRootNavigationState } from 'expo-router';
import { QA_SEED_MARKER } from './index';
import { isSeedLink, parseSeedLink } from './seedLink';
import { runSeed } from './runSeed';

/**
 * QA builds ONLY (mounted by the guarded require in app/_layout.tsx; see
 * lib/qa/index.ts for why it can't reach a release build). Listens for
 * `myapp://qa/seed?scenario=<name>[&now=<UTC instant>]`, seeds, and shows a
 * small status pill Maestro can wait on:
 *
 *   testID `qa-seed-status`, text `QA seed: running <s>` | `QA seed: ok <s> (<n>)`
 *   | `QA seed: error <code>`.
 *
 * The link has no route file (a route under app/ would ship in every build), so
 * expo-router lands it on +not-found. The host navigates home first, which also
 * mounts the (tabs) layout whose SQLiteProvider initializes the database the
 * seed waits for.
 */

const OK_HIDE_MS = 6000;

type Status = { kind: 'running' | 'ok' | 'error'; text: string } | null;

function log(message: string): void {
  // The marker is a runtime string on purpose: it keeps the literal in the
  // QA bundle, which is the positive control for the CI bundle grep.
  console.log(`[${QA_SEED_MARKER}] ${message}`);
}

function goHome(): void {
  try {
    router.dismissTo('/');
  } catch {
    try {
      router.replace('/');
    } catch {
      // Navigation not ready; the seed still runs once the DB initializes.
    }
  }
}

export function QaSeedHost() {
  const navReady = Boolean(useRootNavigationState()?.key);
  const [status, setStatus] = useState<Status>(null);
  const pending = useRef<string[]>([]);
  const handledInitial = useRef(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((next: Status) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
    setStatus(next);
    if (next?.kind === 'ok') {
      hideTimer.current = setTimeout(() => setStatus(null), OK_HIDE_MS);
    }
  }, []);

  const handle = useCallback(
    async (url: string) => {
      if (!isSeedLink(url)) return;
      goHome();
      const parsed = parseSeedLink(url);
      if (!parsed.ok) {
        log(`rejected: ${parsed.error} (length ${parsed.length})`);
        show({ kind: 'error', text: `QA seed: error ${parsed.error}` });
        return;
      }
      const { scenario } = parsed.command;
      show({ kind: 'running', text: `QA seed: running ${scenario}` });
      const outcome = await runSeed(parsed.command);
      if (outcome.ok) {
        log(`ok: ${outcome.scenario}, ${outcome.entries} entries, now ${outcome.now}`);
        show({ kind: 'ok', text: `QA seed: ok ${outcome.scenario} (${outcome.entries})` });
      } else {
        log(`failed: ${outcome.error}`);
        show({ kind: 'error', text: `QA seed: error ${outcome.error}` });
      }
    },
    [show]
  );

  // Links that arrive before navigation is ready wait in `pending`. A ref, not
  // the render value: getInitialURL's callback may run after the flip. The ref
  // flips BEFORE the drain, so a link is either queued-then-drained or handled.
  const navReadyRef = useRef(false);

  const enqueue = useCallback(
    (url: string | null) => {
      if (!url) return;
      if (navReadyRef.current) void handle(url);
      else pending.current.push(url);
    },
    [handle]
  );

  useEffect(() => {
    if (!navReady) return;
    navReadyRef.current = true;
    const queued = pending.current;
    pending.current = [];
    for (const url of queued) void handle(url);
  }, [handle, navReady]);

  useEffect(() => {
    if (!handledInitial.current) {
      handledInitial.current = true;
      Linking.getInitialURL()
        .then(enqueue)
        .catch(() => {});
    }
    const sub = Linking.addEventListener('url', ({ url }) => enqueue(url));
    return () => sub.remove();
  }, [enqueue]);

  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    []
  );

  if (!status) return null;
  return (
    <View pointerEvents="none" style={styles.wrap}>
      <Text testID="qa-seed-status" style={[styles.pill, status.kind === 'error' && styles.error]}>
        {status.text}
      </Text>
    </View>
  );
}

// Fixed colours on purpose: this sits outside the Settings/theme providers and
// only ever renders in QA builds.
const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 48, left: 0, right: 0, alignItems: 'center' },
  pill: {
    backgroundColor: '#222222',
    color: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    fontSize: 12,
    overflow: 'hidden',
  },
  error: { backgroundColor: '#b00020' },
});
