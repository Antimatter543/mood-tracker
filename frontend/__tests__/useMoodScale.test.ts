import { useMoodScale } from '@/components/forms/hooks/useMoodScale';
import { act, create } from 'react-test-renderer';
import React from 'react';

function rendered(opts?: Parameters<typeof useMoodScale>[0]) {
    const box: { current: ReturnType<typeof useMoodScale> | null } = { current: null };
    function Probe() {
        box.current = useMoodScale(opts);
        return null;
    }
    act(() => {
        create(React.createElement(Probe));
    });
    if (!box.current) throw new Error('hook not initialized');
    return box.current;
}

describe('useMoodScale — snapping at low precision', () => {
    it('snaps any value to the nearest integer', () => {
        const { snap } = rendered({ precision: 'low' });
        expect(snap(5.4)).toBe(5);
        expect(snap(5.5)).toBe(6); // round half up via Math.round
        expect(snap(7.9)).toBe(8);
    });

    it('clamps values below 0 to 0', () => {
        const { snap } = rendered({ precision: 'low' });
        expect(snap(-1)).toBe(0);
        expect(snap(-100)).toBe(0);
    });

    it('clamps values above 10 to 10', () => {
        const { snap } = rendered({ precision: 'low' });
        expect(snap(11)).toBe(10);
        expect(snap(99)).toBe(10);
    });

    it('returns 0 for non-finite input', () => {
        const { snap } = rendered({ precision: 'low' });
        expect(snap(Number.NaN)).toBe(0);
        expect(snap(Infinity)).toBe(0);
    });

    it('formats values as integers', () => {
        const { format } = rendered({ precision: 'low' });
        expect(format(5)).toBe('5');
        expect(format(5.7)).toBe('6'); // toFixed(0) rounds
    });
});

describe('useMoodScale — snapping at high precision', () => {
    it('snaps to the nearest half', () => {
        const { snap } = rendered({ precision: 'high' });
        expect(snap(5.2)).toBe(5);
        expect(snap(5.3)).toBe(5.5);
        expect(snap(5.7)).toBe(5.5);
        expect(snap(5.8)).toBe(6);
    });

    it('preserves half-integer inputs', () => {
        const { snap } = rendered({ precision: 'high' });
        expect(snap(2.5)).toBe(2.5);
        expect(snap(7.5)).toBe(7.5);
    });

    it('formats whole numbers without a decimal, halves with one decimal', () => {
        const { format } = rendered({ precision: 'high' });
        expect(format(5)).toBe('5');
        expect(format(5.5)).toBe('5.5');
        expect(format(0)).toBe('0');
    });
});

describe('useMoodScale — geometry', () => {
    it('low precision generates 11 ticks', () => {
        const { values } = rendered({ precision: 'low' });
        expect(values).toHaveLength(11);
        expect(values[0]).toBe('0');
        expect(values[values.length - 1]).toBe('10');
    });

    it('high precision generates 21 ticks', () => {
        const { values } = rendered({ precision: 'high' });
        expect(values).toHaveLength(21);
        expect(values[0]).toBe('0.0');
        expect(values[1]).toBe('0.5');
    });

    it('valueFromOffset and offsetFromValue round-trip after snapping', () => {
        const { valueFromOffset, offsetFromValue, snap } = rendered({ precision: 'high' });
        for (const v of [0, 0.5, 2, 3.5, 7, 10]) {
            const offset = offsetFromValue(v);
            const back = valueFromOffset(offset);
            expect(back).toBe(snap(v));
        }
    });

    it('valueFromOffset handles offsets between snap points', () => {
        const { valueFromOffset } = rendered({ precision: 'low', itemWidth: 60 });
        // halfway between idx 5 (value 5) and idx 6 (value 6) — Math.round
        // rounds half up to 6.
        expect(valueFromOffset(60 * 5.5)).toBe(6);
    });
});
