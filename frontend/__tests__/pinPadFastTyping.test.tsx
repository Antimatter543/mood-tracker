/**
 * The PIN pad under fast typing (components/PinPad.tsx).
 *
 * The bug this guards (found on a real phone, invisible to adb and to tests
 * that await every render): each key built the new PIN from the last RENDERED
 * value, so taps faster than a render dropped or overwrote digits, and OK
 * submitted a stale value. In the PIN setup overlay (two commits per key) a
 * PIN other than the one typed could be stored, and the real app PIN then
 * failed on the lock screen.
 *
 * Model of "the render has not caught up": the parent never passes the new
 * value back (value stays ''), exactly what the pad sees between fast taps.
 */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { PinPad } from '@/components/PinPad';

type View = Awaited<ReturnType<typeof render>>;
const tap = async (view: View, key: string) => fireEvent.press(view.getByTestId(`pin-key-${key}`));

const setup = async (value = '') => {
    const onChange = jest.fn();
    const onSubmit = jest.fn();
    const view = await render(<PinPad value={value} onChange={onChange} onSubmit={onSubmit} />);
    return { view, onChange, onSubmit };
};

describe('PinPad: taps faster than renders', () => {
    it('every digit builds on the last one typed, not the last one rendered', async () => {
        const { view, onChange, onSubmit } = await setup();
        for (const d of '135790') await tap(view, d);
        expect(onChange.mock.calls.map(c => c[0])).toEqual(['1', '13', '135', '1357', '13579', '135790']);
        await tap(view, 'ok');
        expect(onSubmit).toHaveBeenCalledWith('135790');
    });

    it('OK submits the PIN as typed, including the last digit', async () => {
        const { view, onSubmit } = await setup();
        for (const d of '2468') await tap(view, d);
        await tap(view, 'ok');
        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit.mock.calls[0][0]).toBe('2468');
    });

    it('delete works on the typed value too', async () => {
        const { view, onChange, onSubmit } = await setup();
        for (const d of '12349') await tap(view, d);
        await tap(view, 'back');
        expect(onChange).toHaveBeenLastCalledWith('1234');
        await tap(view, 'ok');
        expect(onSubmit).toHaveBeenCalledWith('1234');
    });

    it('keys after OK start a new PIN, even before the parent clears', async () => {
        const { view, onChange, onSubmit } = await setup();
        for (const d of '1111') await tap(view, d);
        await tap(view, 'ok');
        await tap(view, '2');
        expect(onChange).toHaveBeenLastCalledWith('2');
        expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it('too short is never submitted, and the length cap holds', async () => {
        const { view, onChange, onSubmit } = await setup();
        for (const d of '123') await tap(view, d);
        await tap(view, 'ok');
        expect(onSubmit).not.toHaveBeenCalled();
        for (const d of '4567890') await tap(view, d);
        expect(onChange).toHaveBeenLastCalledWith('12345678');
    });

    it('follows the parent when it changes the value (a clear after a wrong PIN)', async () => {
        const onChange = jest.fn();
        const onSubmit = jest.fn();
        const view = await render(<PinPad value="12" onChange={onChange} onSubmit={onSubmit} />);
        await view.rerender(<PinPad value="" onChange={onChange} onSubmit={onSubmit} />);
        await tap(view, '5');
        expect(onChange).toHaveBeenLastCalledWith('5');
    });
});
