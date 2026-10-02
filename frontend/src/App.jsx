import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { useAuth } from './auth/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Bikes from './pages/Bikes';
import BikeDetail from './pages/BikeDetail';
import Components from './pages/Components';
import Rides from './pages/Rides';
import Services from './pages/Services';

function Protected() {
  const { user, ready } = useAuth();
  if (!ready) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }
  return user ? <Layout><Outlet /></Layout> : <Navigate to="/login" replace />;
}

function Public({ children }) {
  const { user, ready } = useAuth();
  return ready && user ? <Navigate to="/" replace /> : children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Public><Login /></Public>} />
      <Route path="/register" element={<Public><Register /></Public>} />
      <Route element={<Protected />}>
        <Route index element={<Dashboard />} />
        <Route path="bikes" element={<Bikes />} />
        <Route path="bikes/:id" element={<BikeDetail />} />
        <Route path="components" element={<Components />} />
        <Route path="rides" element={<Rides />} />
        <Route path="services" element={<Services />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
