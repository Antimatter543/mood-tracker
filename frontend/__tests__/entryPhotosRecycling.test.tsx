/**
 * FlashList RECYCLES cells: as the user scrolls, the component instance that
 * rendered entry A is re-rendered with entry B's props instead of being
 * unmounted. Plain `useState` inside a cell therefore LEAKS from one entry to the
 * next. The photo components hold two such pieces of state:
 *   - ThumbImage's `failed` (A's photo file is missing -> B's good photo would
 *     show A's "unavailable" placeholder),
 *   - EntryPhotos' viewer open/index (A's full-screen viewer would re-open on B).
 * Both are `useRecyclingState` keyed on what they describe. "Recycled" is
 * modelled exactly as FlashList does it: `rerender` the SAME element position
 * with different props.
 */
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';

jest.mock('@/components/OverlayModal', () => ({
    OverlayModal: ({ children, visible }: { children: React.ReactNode; visible: boolean }) => {
        const ReactActual = require('react') as typeof React;
        const { View } = require('react-native');
        return visible ? ReactActual.createElement(View, { testID: 'photo-viewer' }, children) : null;
    },
}));

import { EntryPhotos, ThumbImage, PHOTO_THUMB_SIZE } from '@/components/timeline/EntryPhotos';
import type { EntryPhoto } from '@/components/types';

const colors: any = {
    background: '#000',
    cardBackground: '#111',
    secondaryBackground: '#222',
    text: '#fff',
    textSecondary: '#aaa',
    border: '#333',
    accent: '#4CAF50',
    accentDark: '#388E3C',
    accentLight: 'rgba(76,175,80,0.1)',
    overlays: { tag: '#222', tagBorder: '#333', border: '#333', textSecondary: '#aaa' },
    elevation: { shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, elevation: 8 },
    isDark: true,
};

const photo = (id: number, entryId: number): EntryPhoto => ({
    id,
    entry_id: entryId,
    file_path: `file:///media/${id}.jpg`,
    media_type: 'image',
});

/**
 * expo-image's native host node (it renders `ViewManagerAdapter_ExpoImage` under
 * jest, with `source` normalised to an ARRAY and `onError` expecting a native
 * event). Found by the `recyclingKey` prop only it carries.
 */
const imageNode = (view: any) =>
    view.container.queryAll((n: any) => n.props?.recyclingKey != null && Array.isArray(n.props.source))[0];
const imageUri = (view: any) => imageNode(view).props.source[0].uri;
const failImage = async (view: any) => {
    await act(async () => {
        imageNode(view).props.onError({ nativeEvent: { error: 'not found' } });
    });
};

describe('ThumbImage — recycled into another photo', () => {
    const style = { width: PHOTO_THUMB_SIZE, height: PHOTO_THUMB_SIZE };

    it("does not carry a load failure over to the next photo", async () => {
        const view = await render(<ThumbImage uri="file:///missing.jpg" style={style} colors={colors} />);
        await failImage(view);
        expect(view.queryByLabelText('Photo unavailable')).not.toBeNull();

        // Same photo re-rendered: still failed (no retry storm on every render).
        await view.rerender(<ThumbImage uri="file:///missing.jpg" style={style} colors={colors} />);
        expect(view.queryByLabelText('Photo unavailable')).not.toBeNull();

        // Recycled to a different photo: it must get its own chance to load.
        await view.rerender(<ThumbImage uri="file:///fine.jpg" style={style} colors={colors} />);
        expect(view.queryByLabelText('Photo unavailable')).toBeNull();
        expect(imageUri(view)).toBe('file:///fine.jpg');
    });

    it('keys expo-image recycling on the uri (no flash of the previous picture)', async () => {
        const view = await render(<ThumbImage uri="file:///a.jpg" style={style} colors={colors} />);
        expect(imageNode(view).props.recyclingKey).toBe('file:///a.jpg');
    });

    it('the failure placeholder takes the SAME box as the image (no row height change)', async () => {
        const view = await render(<ThumbImage uri="file:///missing.jpg" style={style} colors={colors} />);
        await failImage(view);
        const placeholder = view.getByLabelText('Photo unavailable');
        const flat = Object.assign({}, ...[placeholder.props.style].flat(Infinity).filter(Boolean));
        expect(flat.width).toBe(PHOTO_THUMB_SIZE);
        expect(flat.height).toBe(PHOTO_THUMB_SIZE);
    });
});

describe('EntryPhotos — recycled into another entry', () => {
    it("does not open the previous entry's viewer on the next entry", async () => {
        const view = await render(<EntryPhotos photos={[photo(1, 10), photo(2, 10)]} colors={colors} />);
        await fireEvent.press(view.getByLabelText('View photo 2'));
        expect(view.queryByTestId('photo-viewer')).not.toBeNull();

        // Same photos, parent re-render: the viewer the user opened stays open.
        await view.rerender(<EntryPhotos photos={[photo(1, 10), photo(2, 10)]} colors={colors} />);
        expect(view.queryByTestId('photo-viewer')).not.toBeNull();

        // Recycled to entry 11's photos: closed.
        await view.rerender(<EntryPhotos photos={[photo(3, 11)]} colors={colors} />);
        expect(view.queryByTestId('photo-viewer')).toBeNull();
    });
});
