import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Alert, Snackbar } from '@mui/material';

const NotifyContext = createContext(null);

export function NotifyProvider({ children }) {
  const [msg, setMsg] = useState(null);
  const [open, setOpen] = useState(false);
  const show = useCallback((severity) => (text) => {
    setMsg({ severity, text });
    setOpen(true);
  }, []);
  const value = useMemo(() => ({ success: show('success'), error: show('error') }), [show]);
  return (
    <NotifyContext.Provider value={value}>
      {children}
      <Snackbar
        open={open}
        autoHideDuration={4500}
        onClose={(_, reason) => reason !== 'clickaway' && setOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={msg?.severity || 'info'} variant="filled" onClose={() => setOpen(false)} sx={{ width: '100%' }}>
          {msg?.text}
        </Alert>
      </Snackbar>
    </NotifyContext.Provider>
  );
}

export const useNotify = () => useContext(NotifyContext);
