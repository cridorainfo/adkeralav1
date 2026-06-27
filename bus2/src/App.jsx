import { Routes, Route, Navigate } from 'react-router-dom';
import ControlApp from './pages/ControlApp';
import DisplayApp from './pages/DisplayApp';
import Home from './pages/Home';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/control" element={<ControlApp />} />
      <Route path="/display" element={<DisplayApp />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
