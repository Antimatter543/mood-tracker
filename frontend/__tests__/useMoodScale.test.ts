import { useMoodScale } from '@/components/forms/hooks/useMoodScale';
import { renderHook } from '@testing-library/react-native';

// useMoodScale is pure (no async / no state mutation in these tests) — we only
// read the derived snap/format/geometry helpers off the first render. RNTL's
// renderHook returns a promise; await it and read `result.current`.
async function rendered(opts?: Parameters<typeof useMoodScale>[0]) {
    const { result } = await renderHook(() => useMoodScale(opts));
    return result.current;
}

describe('useMoodScale — snapping at low precision', () => {
    it('snaps any value to the nearest integer', async () => {
        const { snap } = await rendered({ precision: 'low' });
        expect(snap(5.4)).toBe(5);
        expect(snap(5.5)).toBe(6); // round half up via Math.round
        expect(snap(7.9)).toBe(8);
    });

    it('clamps values below 0 to 0', async () => {
        const { snap } = await rendered({ precision: 'low' });
        expect(snap(-1)).toBe(0);
        expect(snap(-100)).toBe(0);
    });

    it('clamps values above 10 to 10', async () => {
        const { snap } = await rendered({ precision: 'low' });
        expect(snap(11)).toBe(10);
        expect(snap(99)).toBe(10);
    });

    it('returns 0 for non-finite input', async () => {
        const { snap } = await rendered({ precision: 'low' });
        expect(snap(Number.NaN)).toBe(0);
        expect(snap(Infinity)).toBe(0);
    });

    it('formats values as integers', async () => {
        const { format } = await rendered({ precision: 'low' });
        expect(format(5)).toBe('5');
        expect(format(5.7)).toBe('6'); // toFixed(0) rounds
    });
});

describe('useMoodScale — snapping at high precision', () => {
    it('snaps to the nearest half', async () => {
        const { snap } = await rendered({ precision: 'high' });
        expect(snap(5.2)).toBe(5);
        expect(snap(5.3)).toBe(5.5);
        expect(snap(5.7)).toBe(5.5);
        expect(snap(5.8)).toBe(6);
    });

    it('preserves half-integer inputs', async () => {
        const { snap } = await rendered({ precision: 'high' });
        expect(snap(2.5)).toBe(2.5);
        expect(snap(7.5)).toBe(7.5);
    });

    it('formats whole numbers without a decimal, halves with one decimal', async () => {
        const { format } = await rendered({ precision: 'high' });
        expect(format(5)).toBe('5');
        expect(format(5.5)).toBe('5.5');
        expect(format(0)).toBe('0');
    });
});

describe('useMoodScale — geometry', () => {
    it('low precision generates 11 ticks', async () => {
        const { values } = await rendered({ precision: 'low' });
        expect(values).toHaveLength(11);
        expect(values[0]).toBe('0');
        expect(values[values.length - 1]).toBe('10');
    });

    it('high precision generates 21 ticks', async () => {
        const { values } = await rendered({ precision: 'high' });
        expect(values).toHaveLength(21);
        expect(values[0]).toBe('0.0');
        expect(values[1]).toBe('0.5');
    });

    it('valueFromOffset and offsetFromValue round-trip after snapping', async () => {
        const { valueFromOffset, offsetFromValue, snap } = await rendered({ precision: 'high' });
        for (const v of [0, 0.5, 2, 3.5, 7, 10]) {
            const offset = offsetFromValue(v);
            const back = valueFromOffset(offset);
            expect(back).toBe(snap(v));
        }
    });

    it('valueFromOffset handles offsets between snap points', async () => {
        const { valueFromOffset } = await rendered({ precision: 'low', itemWidth: 60 });
        // halfway between idx 5 (value 5) and idx 6 (value 6) — Math.round
        // rounds half up to 6.
        expect(valueFromOffset(60 * 5.5)).toBe(6);
    });
});
