/**
 * Unit tests for useKeyboardHeight — the deterministic keyboard-height tracker
 * that replaced the (Android-edge-to-edge no-op) KeyboardAvoidingView.
 *
 * We capture the listeners registered with Keyboard.addListener, fire a
 * keyboardDidShow with an endCoordinates height, and assert the hook reports it;
 * a keyboardDidHide resets it to 0. (Real occlusion behavior is release-APK only
 * — this proves the height plumbing the padding/scroll math depends on.)
 */
import React from 'react';
import { Keyboard, Text } from 'react-native';
import { render, act } from '@testing-library/react-native';

import { useKeyboardHeight } from '@/hooks/useKeyboardHeight';

// Capture registered listeners so the test can fire keyboard events.
type Listener = (e: any) => void;
const listeners: Record<string, Listener[]> = {};

beforeEach(() => {
    for (const k of Object.keys(listeners)) delete listeners[k];
    jest.spyOn(Keyboard, 'addListener').mockImplementation((event: any, cb: any) => {
        (listeners[event] ??= []).push(cb);
        return { remove: () => {} } as any;
    });
});

afterEach(() => jest.restoreAllMocks());

const fire = (event: string, payload?: any) =>
    (listeners[event] ?? []).forEach((cb) => cb(payload));

// Probe component surfaces the hook value as text we can read.
function Probe() {
    const h = useKeyboardHeight();
    return <Text>{`h=${h}`}</Text>;
}

const heightText = (screen: any): string =>
    screen.container
        .queryAll((n: any) => n.type === 'Text')
        .map((n: any) => n.props.children)
        .find((c: any) => typeof c === 'string' && c.startsWith('h=')) ?? '';

describe('useKeyboardHeight', () => {
    it('starts at 0 (keyboard hidden)', async () => {
        const screen = await render(<Probe />);
        expect(heightText(screen)).toBe('h=0');
    });

    it('reports the keyboard height on keyboardDidShow', async () => {
        const screen = await render(<Probe />);
        await act(async () => {
            fire('keyboardDidShow', { endCoordinates: { height: 804 } });
        });
        expect(heightText(screen)).toBe('h=804');
    });

    it('resets to 0 on keyboardDidHide', async () => {
        const screen = await render(<Probe />);
        await act(async () => {
            fire('keyboardDidShow', { endCoordinates: { height: 804 } });
        });
        expect(heightText(screen)).toBe('h=804');
        await act(async () => {
            fire('keyboardDidHide');
        });
        expect(heightText(screen)).toBe('h=0');
    });

    it('registers the Android-available Did* events', async () => {
        await render(<Probe />);
        // keyboardDidShow / keyboardDidHide are the events Android actually fires
        // (Will* are iOS-only); the hook must listen to these or it never updates.
        expect(listeners['keyboardDidShow']?.length).toBeGreaterThanOrEqual(1);
        expect(listeners['keyboardDidHide']?.length).toBeGreaterThanOrEqual(1);
    });
});
