import { Link as RouterLink } from 'react-router-dom';
import { AppBar, Box, Toolbar, Typography } from '@mui/material';
import BikeIcon from '@mui/icons-material/PedalBikeOutlined';

// Drop real photos at public/images/auth-left.jpg and auth-right.jpg to override the illustrations.
const panel = (name) => ({
  display: { xs: 'none', md: 'block' },
  backgroundImage: `url(/images/${name}.jpg), url(/images/${name}.svg)`,
  backgroundSize: 'cover',
  backgroundPosition: 'center',
});

export default function AuthCard({ title, subtitle, children }) {
  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', bgcolor: '#fff' }}>
      <AppBar position="static" color="primary">
        <Toolbar sx={{ maxWidth: 1200, width: '100%', mx: 'auto' }}>
          <Box component={RouterLink} to="/" sx={{ display: 'flex', alignItems: 'center', color: 'inherit', textDecoration: 'none' }}>
            <BikeIcon sx={{ mr: 1, color: 'secondary.main' }} />
            <Typography variant="h6" sx={{ fontWeight: 700 }}>BikeLedger</Typography>
          </Box>
        </Toolbar>
      </AppBar>

      <Box sx={{ flexGrow: 1, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr minmax(380px, 460px) 1fr' } }}>
        <Box sx={panel('auth-left')} />
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', p: { xs: 3, md: 5 } }}>
          <Box sx={{ width: '100%', maxWidth: 380 }}>
            <Typography variant="h4" component="h1" align="center" sx={{ fontWeight: 800, mb: 1 }}>{title}</Typography>
            {subtitle && <Typography align="center" color="text.secondary" sx={{ mb: 3 }}>{subtitle}</Typography>}
            {children}
          </Box>
        </Box>
        <Box sx={panel('auth-right')} />
      </Box>
    </Box>
  );
}
