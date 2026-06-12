/**
 * Unit tests for the single-vs-multi photo layout decision used by the Timeline
 * EntryCard. One photo heroes; multiple tile into a strip; zero renders nothing.
 */
import { photoLayoutFor } from '@/components/timeline/photoLayout';

describe('photoLayoutFor', () => {
    it('returns "none" for zero photos', () => {
        expect(photoLayoutFor(0)).toEqual({ kind: 'none' });
    });

    it('returns "single" for exactly one photo', () => {
        expect(photoLayoutFor(1)).toEqual({ kind: 'single' });
    });

    it('returns "grid" for two or more photos', () => {
        expect(photoLayoutFor(2)).toEqual({ kind: 'grid' });
        expect(photoLayoutFor(3)).toEqual({ kind: 'grid' });
        expect(photoLayoutFor(50)).toEqual({ kind: 'grid' });
    });

    it('treats negative / non-finite counts as none (never throws)', () => {
        expect(photoLayoutFor(-1)).toEqual({ kind: 'none' });
        expect(photoLayoutFor(Number.NaN)).toEqual({ kind: 'none' });
    });
});
