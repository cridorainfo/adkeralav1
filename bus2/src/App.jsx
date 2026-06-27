import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import ControlApp from './pages/ControlApp';
import DisplayApp from './pages/DisplayApp';
import DriverConnect from './pages/DriverConnect';
import Home from './pages/Home';

function NativeDriverRedirect() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!window.Capacitor?.isNativePlatform?.()) return;
    const path = window.location.pathname;
    if (path === '/' || path === '/index.html') {
      navigate('/driver', { replace: true });
    }
  }, [navigate]);

  return null;
}

export default function App() {
  return (
    <>
      <NativeDriverRedirect />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/driver" element={<DriverConnect />} />
        <Route path="/control" element={<ControlApp />} />
        <Route path="/display" element={<DisplayApp />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
