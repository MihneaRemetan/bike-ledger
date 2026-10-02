import { createTheme } from '@mui/material/styles';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';

// Brand green is used for the header and selected items in both modes; `primary` is lighter in dark mode.
const BRAND = { main: '#1f5c4a', dark: '#174839', contrastText: '#ffffff' };

export function createAppTheme(mode) {
  const dark = mode === 'dark';
  return createTheme({
    palette: {
      mode,
      primary: { main: dark ? '#5bbf9f' : '#1f5c4a' },
      secondary: { main: '#e8a33d' },
      brand: BRAND,
      background: dark ? { default: '#101714', paper: '#18211d' } : { default: '#f6f3ee', paper: '#ffffff' },
      divider: dark ? '#2b3833' : '#e4ded3',
      track: dark ? '#2b3833' : '#ece7dd', // empty part of progress bars
      status: { OK: '#2e8b57', WARN: '#e07b00', REPLACE: '#c62828', RETIRED: '#8a8a8a' },
    },
    shape: { borderRadius: 10 },
    typography: {
      fontFamily: '"Inter", system-ui, sans-serif',
      h4: { fontWeight: 700 },
      h5: { fontWeight: 700 },
      h6: { fontWeight: 600 },
      button: { textTransform: 'none', fontWeight: 600 },
    },
    components: {
      MuiPaper: { defaultProps: { elevation: 0 }, styleOverrides: { root: { backgroundImage: 'none' } } },
      MuiCard: {
        defaultProps: { variant: 'outlined' },
        styleOverrides: { root: ({ theme }) => ({ borderColor: theme.palette.divider }) },
      },
      MuiTableCell: { styleOverrides: { head: { fontWeight: 600, whiteSpace: 'nowrap' } } },
      MuiButton: { defaultProps: { disableElevation: true } },
      MuiAppBar: {
        defaultProps: { elevation: 0 },
        styleOverrides: { colorPrimary: { backgroundColor: BRAND.main, color: '#fff' } },
      },
    },
  });
}
