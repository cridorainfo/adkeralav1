import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import AppErrorBoundary from './components/AppErrorBoundary';
import { BusStoreProvider } from './hooks/useBusStore';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <BrowserRouter>
        <BusStoreProvider>
          <App />
        </BusStoreProvider>
      </BrowserRouter>
    </AppErrorBoundary>
  </React.StrictMode>
);
