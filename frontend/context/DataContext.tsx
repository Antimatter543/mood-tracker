import { createContext, useContext } from 'react';

// The app-wide "a write happened" signal. This context intentionally exposes
// ONLY the trigger — `refetchEntries()` — which any write path calls after
// mutating the DB. The reload SIGNAL that screens subscribe to is the external
// data-version store (context/dataRefreshStore.ts), not a value on this context:
// a `refreshCount` number handed down here did NOT propagate to the bottom-tab
// screens for in-place updates (device-proven — see dataRefreshStore.ts). So the
// value screens read lives in the store; this context is just the write-signal
// handle.
interface DataContextType {
    /** Call after any DB write so every subscribed screen reloads. Backed by
     *  `bumpDataVersion()` from context/dataRefreshStore.ts. */
    refetchEntries: () => void;
}

// Create the context with a no-op default (overridden by the real provider).
const DataContext = createContext<DataContextType>({
    refetchEntries: () => {},
});

// Export a provider to wrap components that need to access the context.
export const DataProvider = DataContext.Provider;

// Hook to make using the context easier.
export const useDataContext = () => useContext(DataContext);
