/**
 * Jest stand-in for `@shopify/flash-list`'s FlashList (auto-applied: a root
 * `__mocks__` next to node_modules mocks the package in every test).
 *
 * WHY a probe and not the real list: under jest a virtualized list gets no real
 * layout or scroll events, so what it renders says nothing about what a device
 * renders (tasks/lessons.md 2026-09-13, "How to test any of this"). The Timeline's
 * contracts are about the DATA it hands the list and the CALLBACKS it wires, so
 * this probe:
 *   - puts every prop FlashList received on a host View carrying the same testID,
 *     so a test reads `getByTestId('timeline-list').props.data` /
 *     `.onEndReached` / `.maintainVisibleContentPosition` directly;
 *   - renders EVERY row through the real `renderItem` (unvirtualized) plus the
 *     footer, so cards and headers are queryable;
 *   - exposes an imperative ref whose methods are jest.fns on `flashListProbe`, so
 *     a test can script `getFirstVisibleIndex()` / `getFirstItemOffset()` and
 *     assert `scrollToIndex(...)` / `scrollToOffset(...)`.
 *
 * Reach the probe with a plain `require('@shopify/flash-list')` in the test,
 * NEVER `jest.requireMock(...)`: for a root-__mocks__ package requireMock
 * returns a SEPARATE module instance, so scripting its jest.fns silently never
 * reaches the copy the component imported (cost a debug cycle, 2026-09-28).
 *
 * Everything else (useRecyclingState, useLayoutState, types, ...) is the REAL
 * package. A test that wants the REAL FlashList overrides this mock with
 * `jest.mock('@shopify/flash-list', () => jest.requireActual(...))` plus the
 * measureLayout stubs: see __tests__/timelineRealFlashList.test.tsx (don't copy
 * the package's jestSetup.js verbatim, it maps to an export 2.0.2 removed).
 */
import React from 'react';
import { View } from 'react-native';

const actual = jest.requireActual('@shopify/flash-list');

export const flashListProbe = {
    scrollToOffset: jest.fn(),
    scrollToIndex: jest.fn(),
    scrollToTop: jest.fn(),
    /** -1 = "not laid out"; tests set a return value to script the viewport. */
    getFirstVisibleIndex: jest.fn(() => -1),
    /** The content padding above the first row (DBViewer's `paddingTop: 4`). */
    getFirstItemOffset: jest.fn(() => 4),
    reset() {
        this.scrollToOffset.mockReset();
        this.scrollToIndex.mockReset();
        this.scrollToTop.mockReset();
        this.getFirstVisibleIndex.mockReset();
        this.getFirstVisibleIndex.mockImplementation(() => -1);
        this.getFirstItemOffset.mockReset();
        this.getFirstItemOffset.mockImplementation(() => 4);
    },
};

const renderSlot = (slot: unknown): React.ReactNode => {
    if (slot == null) return null;
    if (React.isValidElement(slot)) return slot;
    return React.createElement(slot as React.ComponentType);
};

export const FlashList = React.forwardRef<unknown, any>(function FlashListProbe(props, ref) {
    React.useImperativeHandle(ref, () => ({
        scrollToOffset: flashListProbe.scrollToOffset,
        scrollToIndex: flashListProbe.scrollToIndex,
        scrollToTop: flashListProbe.scrollToTop,
        getFirstVisibleIndex: flashListProbe.getFirstVisibleIndex,
        getFirstItemOffset: flashListProbe.getFirstItemOffset,
    }));
    const { data, renderItem, keyExtractor, ListFooterComponent, ListHeaderComponent } = props;
    const rows: unknown[] = data ?? [];
    return (
        <View {...props}>
            {renderSlot(ListHeaderComponent)}
            {rows.map((item, index) => (
                <View key={keyExtractor ? keyExtractor(item, index) : String(index)}>
                    {renderItem ? renderItem({ item, index, target: 'Cell' }) : null}
                </View>
            ))}
            {renderSlot(ListFooterComponent)}
        </View>
    );
});

// The real hooks, so recycling-state behaviour under test is FlashList's own.
export const useRecyclingState = actual.useRecyclingState;
export const useLayoutState = actual.useLayoutState;
export const useMappingHelper = actual.useMappingHelper;
