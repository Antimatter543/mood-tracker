/**
 * CLASS-LEVEL invariant: every screenshot committed under `store/` is a finished
 * artefact, never a raw device capture.
 *
 * On 2026-09-04 a parallel agent wrote a raw 1000x2000 device capture over a framed
 * slide in `store/play-screenshots/en-US/phoneScreenshots/`. The write landed between
 * a render and a Play upload, so an unframed screenshot with no headline went live on
 * the store page, and it survived the upload check, because that check compared
 * Play's sha256 against the local file and a single write had corrupted BOTH sides of
 * the comparison. Nothing in the repo could have failed: the files were type-correct,
 * the suite was green, and the only gate was a script somebody had to remember to run.
 *
 * So the gate moves here, into the jest run that `scripts/release.sh` and CI already
 * execute. It asserts INTRINSIC properties of the bytes on disk:
 *   1. the Play set is a plausible store rail (2..8 slides, sequentially numbered),
 *   2. every slide is exactly 1080x2160, a raw capture is 1000x2000 and fails here,
 *   3. every shipped PNG is COMPLETE, a sane byte count plus an intact trailing IEND
 *      chunk, so a half-written or placeholder file cannot pass as a slide,
 *   4. no raw capture is byte-identical to a framed slide, the exact clobber that
 *      shipped,
 *   5. the unframed F-Droid set stays unframed and stays distinct from the Play set.
 *
 * This is the cheap always-on floor, not the whole check. `python3
 * store/make-soulsync-screenshots.py --check-only` is the richer local gate: it decodes
 * pixels and asserts dark ground at the canvas edges, bright type in the headline band,
 * and intact dither. Decoding PNG pixels needs a decoder this project does not ship, so
 * the test reads the IHDR header with plain `fs` and adds no dependency.
 */
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

const REPO = path.join(__dirname, '..', '..');
const FRAMED_DIR = path.join(REPO, 'store', 'play-screenshots', 'en-US', 'phoneScreenshots');
const RAW_DIR = path.join(REPO, 'store', 'screenshots', 'raw');
const FASTLANE_DIR = path.join(
    REPO, 'fastlane', 'metadata', 'android', 'en-US', 'images', 'phoneScreenshots',
);

/** The exact canvas `make-soulsync-screenshots.py` renders, and what Play receives. */
const SLIDE_WIDTH = 1080;
const SLIDE_HEIGHT = 2160;
/** Play shows at most 8 phone screenshots and needs at least 2 to look deliberate. */
const MIN_SLIDES = 2;
const MAX_SLIDES = 8;
/** A framed slide is ~0.9MB. The band only has to exclude a stub or a runaway file. */
const MIN_BYTES = 100 * 1024;
const MAX_BYTES = 3 * 1024 * 1024;
/** Raw captures are 1000px wide; the F-Droid crops keep that width. */
const MIN_UNFRAMED_WIDTH = 1000;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Every PNG ends with this exact 12-byte chunk: length 0, type IEND, its fixed CRC. */
const PNG_IEND = Buffer.from([
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

interface Slide {
    file: string;
    width: number;
    height: number;
    bytes: number;
    /** The file ends in a well-formed IEND chunk, i.e. the write finished. */
    complete: boolean;
    sha256: string;
}

/** PNG filenames in `dir`, numerically ordered. Throws loudly if the dir is gone. */
function listPngs(dir: string, label: string): string[] {
    if (!fs.existsSync(dir)) {
        throw new Error(
            `${label} directory is missing: ${dir}\n` +
            'These images ship to a store listing and are tracked in git, a missing ' +
            'directory means they were moved or deleted, not that this test is stale.',
        );
    }
    return fs
        .readdirSync(dir)
        .filter(f => f.toLowerCase().endsWith('.png'))
        .sort((a, b) => {
            const [na, nb] = [parseInt(a, 10), parseInt(b, 10)];
            if (Number.isNaN(na) || Number.isNaN(nb)) return a.localeCompare(b);
            return na - nb;
        });
}

/**
 * Read a PNG's dimensions straight out of its header. The IHDR chunk is mandated by
 * the spec to be the first chunk, so width/height are always at bytes 16..23,
 * big-endian, right after the 8-byte signature and the chunk's length + type.
 */
function readSlide(dir: string, file: string): Slide {
    const buf = fs.readFileSync(path.join(dir, file));
    if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
        throw new Error(`${path.join(dir, file)} is not a PNG (bad signature)`);
    }
    if (buf.subarray(12, 16).toString('latin1') !== 'IHDR') {
        throw new Error(`${path.join(dir, file)} has no leading IHDR chunk`);
    }
    return {
        file,
        width: buf.readUInt32BE(16),
        height: buf.readUInt32BE(20),
        bytes: buf.length,
        complete: buf.subarray(buf.length - PNG_IEND.length).equals(PNG_IEND),
        sha256: createHash('sha256').update(buf).digest('hex'),
    };
}

const readAll = (dir: string, label: string): Slide[] =>
    listPngs(dir, label).map(f => readSlide(dir, f));

const framed = readAll(FRAMED_DIR, 'Play screenshot');
const raws = readAll(RAW_DIR, 'Raw capture');
const fastlane = readAll(FASTLANE_DIR, 'F-Droid screenshot');

const framedShas = new Map(framed.map(s => [s.sha256, s.file]));
const size = (s: Slide) => `${s.width}x${s.height}`;

describe('store/play-screenshots, the framed set uploaded to Google Play', () => {
    it(`holds between ${MIN_SLIDES} and ${MAX_SLIDES} slides`, () => {
        expect(framed.length).toBeGreaterThanOrEqual(MIN_SLIDES);
        expect(framed.length).toBeLessThanOrEqual(MAX_SLIDES);
    });

    it('is numbered 01..NN with no gaps (upload order is rail order)', () => {
        const expected = framed.map((_, i) => `${String(i + 1).padStart(2, '0')}.png`);
        expect(framed.map(s => s.file)).toEqual(expected);
    });

    describe.each(framed.map(s => [s.file, s] as const))('%s', (file, slide) => {
        it(`is exactly ${SLIDE_WIDTH}x${SLIDE_HEIGHT}`, () => {
            // A raw device capture is 1000x2000 and dies right here.
            expect(`${file} ${size(slide)}`).toBe(`${file} ${SLIDE_WIDTH}x${SLIDE_HEIGHT}`);
        });

        it('was written in full (ends in an intact IEND chunk)', () => {
            expect(`${file} complete=${slide.complete}`).toBe(`${file} complete=true`);
        });

        it('weighs a plausible amount for a rendered slide', () => {
            // Names the file via the enclosing describe title.
            expect(slide.bytes).toBeGreaterThanOrEqual(MIN_BYTES);
            expect(slide.bytes).toBeLessThanOrEqual(MAX_BYTES);
        });
    });
});

describe('store/screenshots/raw, the generator INPUT never becomes the output', () => {
    it('has raw captures to render from', () => {
        expect(raws.length).toBeGreaterThan(0);
    });

    it('contains no file that is byte-identical to a shipped slide', () => {
        // The 2026-09-04 failure exactly: a raw capture copied over a framed slide.
        const clobbered = raws
            .filter(r => framedShas.has(r.sha256))
            .map(r => `${r.file} == play-screenshots/${framedShas.get(r.sha256)}`);
        expect(clobbered).toEqual([]);
    });
});

describe('fastlane phoneScreenshots, the unframed F-Droid set', () => {
    it(`holds between 1 and ${MAX_SLIDES} images`, () => {
        expect(fastlane.length).toBeGreaterThan(0);
        expect(fastlane.length).toBeLessThanOrEqual(MAX_SLIDES);
    });

    it('is numbered 1..N with no gaps', () => {
        const expected = fastlane.map((_, i) => `${i + 1}.png`);
        expect(fastlane.map(s => s.file)).toEqual(expected);
    });

    it('carries no framed Play slide (F-Droid wants the bare screen)', () => {
        const framedShaped = fastlane
            .filter(s => s.width === SLIDE_WIDTH && s.height === SLIDE_HEIGHT)
            .map(s => `${s.file} ${size(s)}`);
        expect(framedShaped).toEqual([]);
    });

    it('shares no bytes with the Play set', () => {
        const shared = fastlane
            .filter(s => framedShas.has(s.sha256))
            .map(s => `${s.file} == play-screenshots/${framedShas.get(s.sha256)}`);
        expect(shared).toEqual([]);
    });

    it('was written in full (every file ends in an intact IEND chunk)', () => {
        const partial = fastlane.filter(s => !s.complete).map(s => s.file);
        expect(partial).toEqual([]);
    });

    it(`keeps full capture width (>= ${MIN_UNFRAMED_WIDTH}px)`, () => {
        const narrow = fastlane
            .filter(s => s.width < MIN_UNFRAMED_WIDTH)
            .map(s => `${s.file} ${size(s)}`);
        expect(narrow).toEqual([]);
    });
});
