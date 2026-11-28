/**
 * Class-level guard for every card rendered in an OverlayModal: no percentage
 * maxHeight. OverlayModal's wrapper hugs the card, so '85%' resolves to 85% of
 * the card's own height and always cuts off its last lines (#56: the day
 * health card, Rename / Delete group, backup Technical details; the distress
 * Technical details had the same style). Cards shrink to the window with
 * flexShrink: 1 instead.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..');

function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return sourceFiles(p);
        return /\.tsx$/.test(e.name) ? [p] : [];
    });
}

const overlayUsers = ['components', 'app']
    .flatMap(d => sourceFiles(path.join(ROOT, d)))
    .filter(f => /<OverlayModal\b/.test(fs.readFileSync(f, 'utf8')));

describe('cards inside OverlayModal', () => {
    it('finds the overlay dialogs (the scan is not vacuous)', () => {
        const names = overlayUsers.map(f => path.basename(f));
        expect(names).toEqual(expect.arrayContaining(['DistressDetailsDialog.tsx', 'BackupStrengthDialog.tsx']));
    });

    it.each(overlayUsers.map(f => [path.relative(ROOT, f), f]))('%s uses no percentage maxHeight', (_rel, file) => {
        expect(fs.readFileSync(file, 'utf8')).not.toMatch(/maxHeight:\s*['"]\d+(\.\d+)?%['"]/);
    });
});
