import { createContext, useContext } from 'react';

// Define the structure of our context
interface DataContextType {
    refreshCount: number;
    refetchEntries: () => void;
}

// Create the context with a default value (which can be overridden later)
const DataContext = createContext<DataContextType>({
    refreshCount: 0,
    refetchEntries: () => {},
});

// Export a provider to wrap components that need to access the context. 
export const DataProvider = DataContext.Provider;

// Hook to make using the context easier.
export const useDataContext = () => useContext(DataContext);