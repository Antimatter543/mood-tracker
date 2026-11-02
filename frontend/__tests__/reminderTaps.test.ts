/**
 * subscribeToReminderTaps: tapping one of OUR reminder notifications (warm, or
 * the tap that launched a killed app) is delivered exactly once; foreign
 * notifications and non-default actions are ignored.
 */
import type * as NotificationsModule from 'expo-notifications';

jest.mock('expo-notifications');

const OURS = 'soulsync-reminder-abc';

const response = (identifier: string, opts: { date?: number; action?: string } = {}) =>
    ({
        actionIdentifier: opts.action ?? 'expo.modules.notifications.actions.DEFAULT',
        notification: {
            date: opts.date ?? 1000,
            request: { identifier, content: { title: 'How are you?', body: 'Log a mood' } },
        },
    }) as any;

/** Fresh lib + mock per test: the dedup key is module-level state. */
function load() {
    jest.resetModules();
    const lib = require('@/lib/notifications') as typeof import('@/lib/notifications');
    const N = require('expo-notifications') as typeof NotificationsModule;
    const addListener = N.addNotificationResponseReceivedListener as jest.Mock;
    const getLast = N.getLastNotificationResponse as jest.Mock;
    getLast.mockReturnValue(null);
    addListener.mockReturnValue({ remove: jest.fn() });
    return {
        N,
        addListener,
        getLast,
        subscribe: lib.subscribeToReminderTaps,
        /** Simulate a native warm tap on the most recently registered listener. */
        fire: (r: any) => addListener.mock.calls.at(-1)![0](r),
    };
}

describe('subscribeToReminderTaps', () => {
    it('a warm tap on our reminder is delivered and dismisses the tray', () => {
        const { N, subscribe, fire } = load();
        const handler = jest.fn();
        subscribe(handler);
        fire(response(OURS));
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith({ identifier: OURS, title: 'How are you?', body: 'Log a mood' });
        expect(N.dismissAllNotificationsAsync).toHaveBeenCalled();
    });

    it('a cold-start response is delivered once, then cleared', () => {
        const { N, getLast, subscribe } = load();
        getLast.mockReturnValue(response(OURS));
        const handler = jest.fn();
        subscribe(handler);
        expect(handler).toHaveBeenCalledTimes(1);
        expect(N.clearLastNotificationResponse).toHaveBeenCalled();
    });

    it('does not re-handle the same response on a later subscribe (remount / tab switch)', () => {
        const { getLast, subscribe } = load();
        getLast.mockReturnValue(response(OURS)); // stale: native side never cleared it
        const first = jest.fn();
        const second = jest.fn();
        subscribe(first);
        subscribe(second);
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).not.toHaveBeenCalled();
    });

    it('does not double-handle when the listener AND getLast deliver the same response', () => {
        const { getLast, subscribe, fire } = load();
        getLast.mockReturnValue(response(OURS));
        const handler = jest.fn();
        subscribe(handler);
        fire(response(OURS));
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it("handles tomorrow's tap on the same reminder (same identifier, new delivery date)", () => {
        const { subscribe, fire } = load();
        const handler = jest.fn();
        subscribe(handler);
        fire(response(OURS, { date: 1000 }));
        fire(response(OURS, { date: 1000 + 86_400_000 }));
        expect(handler).toHaveBeenCalledTimes(2);
    });

    it('ignores a non-default action', () => {
        const { N, subscribe, fire } = load();
        const handler = jest.fn();
        subscribe(handler);
        fire(response(OURS, { action: 'expo.modules.notifications.actions.DISMISS' }));
        expect(handler).not.toHaveBeenCalled();
        expect(N.dismissAllNotificationsAsync).not.toHaveBeenCalled();
    });

    it('ignores notifications that are not ours', () => {
        const { subscribe, fire } = load();
        const handler = jest.fn();
        subscribe(handler);
        fire(response('some-other-feature-123'));
        expect(handler).not.toHaveBeenCalled();
    });

    it('accepts the legacy daily-reminder identifier', () => {
        const { subscribe, fire } = load();
        const handler = jest.fn();
        subscribe(handler);
        fire(response('soulsync-daily-reminder'));
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('unsubscribe removes the native listener', () => {
        const { addListener, subscribe } = load();
        const remove = jest.fn();
        addListener.mockReturnValue({ remove });
        subscribe(jest.fn())();
        expect(remove).toHaveBeenCalled();
    });
});
