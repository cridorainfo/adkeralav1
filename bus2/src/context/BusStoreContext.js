import { createContext, useContext } from 'react';

export const BusStoreContext = createContext(null);

export function useBusStore() {
  const ctx = useContext(BusStoreContext);
  if (!ctx) {
    throw new Error('useBusStore must be used within BusStoreProvider');
  }
  return ctx;
}
