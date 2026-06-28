import { createContext, useContext } from 'react';

export const DriverControlContext = createContext({
  disconnect: async () => {},
  plate: '',
});

export function useDriverControl() {
  return useContext(DriverControlContext);
}
