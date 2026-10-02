import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ColorModeProvider } from './ColorMode';
import { AuthProvider } from './auth/AuthContext';
import { NotifyProvider } from './components/Notify';
import App from './App';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ColorModeProvider>
      <BrowserRouter>
        <NotifyProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </NotifyProvider>
      </BrowserRouter>
    </ColorModeProvider>
  </StrictMode>
);
