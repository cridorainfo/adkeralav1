import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App.jsx';
import { AuthProvider } from './lib/auth.jsx';
import './styles/portal.css';
// react-leaflet requires this explicitly (see its own setup docs) — without it, MapContainer's
// panes/tiles/markers fall back to unstyled positioning and can render collapsed or with clicks
// landing on the wrong lat/lng. Never actually imported anywhere in this project before now,
// including by FleetMap.jsx, which has the same MapContainer usage — TestLabPanel.jsx's click-
// to-add-stop map is what surfaced it (map clicks not registering stops correctly), but this
// import is global, so it fixes both.
import 'leaflet/dist/leaflet.css';

registerSW({ immediate: true });

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
