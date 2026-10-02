import { Link as RouterLink } from 'react-router-dom';
import ColorModeToggle from '../components/ColorModeToggle';
import { AppBar, Box, Button, Card, CardContent, Container, Toolbar, Typography } from '@mui/material';
import BikeIcon from '@mui/icons-material/PedalBikeOutlined';
import WearIcon from '@mui/icons-material/SpeedOutlined';
import SwapIcon from '@mui/icons-material/SwapHorizOutlined';
import GpxIcon from '@mui/icons-material/RouteOutlined';
import CostIcon from '@mui/icons-material/PaymentsOutlined';
import ChartIcon from '@mui/icons-material/BarChartOutlined';
import LockIcon from '@mui/icons-material/LockOutlined';
import { alpha } from '@mui/material/styles';
import WearBar from '../components/WearBar';

const SAMPLE = [
  { name: 'Chain', sub: 'Gravel bike', wearKm: 3420, maxKm: 4000, wearPct: 0.855, status: 'WARN' },
  { name: 'Rear tyre', sub: 'Gravel bike', wearKm: 4210, maxKm: 4000, wearPct: 1.053, status: 'REPLACE' },
  { name: 'Cassette', sub: 'Gravel bike', wearKm: 3900, maxKm: 12000, wearPct: 0.325, status: 'OK' },
];

const FEATURES = [
  { icon: <WearIcon />, title: 'Automatic wear tracking', text: 'Wear is calculated from the rides you log while each part was mounted. Add, edit or delete a ride and every affected part updates instantly.' },
  { icon: <SwapIcon />, title: 'One-step replacements', text: 'Log a replacement service and the old part is retired while the new one is mounted, in a single action. Full history stays on record.' },
  { icon: <GpxIcon />, title: 'GPX import', text: 'Upload a ride exported from Strava or Garmin. Distance, duration, elevation and date are filled in for you, with a preview before saving.' },
  { icon: <CostIcon />, title: 'Maintenance costs', text: 'See what each bike costs you, in total and per kilometre, based on the services you log.' },
  { icon: <ChartIcon />, title: 'Dashboard & alerts', text: 'Monthly distance charts and a list of parts at 80% or past their limit, so nothing wears out by surprise.' },
  { icon: <LockIcon />, title: 'Private by design', text: 'Every account only sees its own bikes, parts, rides and services.' },
];

export default function Landing() {
  return (
    <Box sx={{ minHeight: '100vh' }}>
      <AppBar position="sticky" color="primary">
        <Toolbar sx={{ maxWidth: 1200, width: '100%', mx: 'auto' }}>
          <BikeIcon sx={{ mr: 1, color: 'secondary.main' }} />
          <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 700 }}>BikeLedger</Typography>
          <ColorModeToggle sx={{ mr: 1 }} />
          <Button color="inherit" component={RouterLink} to="/login">Log in</Button>
          <Button variant="contained" color="secondary" component={RouterLink} to="/register" sx={{ ml: 1, color: '#000' }}>Sign up</Button>
        </Toolbar>
      </AppBar>

      <Box
        sx={{
          color: '#fff',
          pt: { xs: 6, md: 12 },
          pb: { xs: 8, md: 14 },
          backgroundColor: 'brand.main',
          backgroundImage: {
            xs: 'linear-gradient(rgba(18,58,46,0.82), rgba(18,58,46,0.82)), url(/images/hero.jpg)',
            md: 'linear-gradient(90deg, rgba(18,58,46,0.92) 0%, rgba(18,58,46,0.7) 45%, rgba(18,58,46,0.25) 100%), url(/images/hero.jpg)',
          },
          backgroundSize: 'cover',
          backgroundPosition: 'center 60%',
        }}
      >
        <Container maxWidth="lg" sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.1fr 1fr' }, gap: 6, alignItems: 'center' }}>
          <Box>
            <Typography variant="h3" component="h1" sx={{ fontWeight: 800, fontSize: { xs: '2.1rem', md: '3rem' }, lineHeight: 1.15 }}>
              Know when your bike parts wear out, before they fail.
            </Typography>
            <Typography sx={{ mt: 2, mb: 4, fontSize: '1.1rem', opacity: 0.9, maxWidth: 520 }}>
              BikeLedger is a maintenance logbook for cyclists. Log your rides and parts, and it tracks wear on every chain, tyre and brake pad for you.
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <Button size="large" variant="contained" color="secondary" component={RouterLink} to="/register" sx={{ color: '#000' }}>Get started, it's free</Button>
              <Button size="large" variant="outlined" component={RouterLink} to="/login" sx={{ color: '#fff', borderColor: 'rgba(255,255,255,0.6)' }}>Log in</Button>
            </Box>
          </Box>

          <Card sx={{ borderColor: 'transparent' }} aria-label="Example of component wear tracking">
            <CardContent sx={{ p: 3 }}>
              <Typography variant="overline" color="text.secondary">Example · wear overview</Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, mt: 1 }}>
                {SAMPLE.map((c) => (
                  <Box key={c.name}>
                    <Typography fontWeight={600}>{c.name} <Typography component="span" variant="body2" color="text.secondary">· {c.sub}</Typography></Typography>
                    <WearBar component={c} />
                  </Box>
                ))}
              </Box>
            </CardContent>
          </Card>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ py: { xs: 6, md: 10 } }}>
        <Typography variant="h4" component="h2" align="center" sx={{ mb: 1 }}>Everything your bike needs to stay healthy</Typography>
        <Typography align="center" color="text.secondary" sx={{ mb: 5 }}>Simple tools built around how cyclists actually maintain their bikes.</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' }, gap: 3 }}>
          {FEATURES.map((f) => (
            <Card key={f.title}>
              <CardContent sx={{ p: 3 }}>
                <Box sx={{ width: 44, height: 44, borderRadius: 2, bgcolor: (t) => alpha(t.palette.primary.main, 0.14), color: 'primary.main', display: 'grid', placeItems: 'center', mb: 2 }}>{f.icon}</Box>
                <Typography variant="h6" sx={{ mb: 0.5 }}>{f.title}</Typography>
                <Typography variant="body2" color="text.secondary">{f.text}</Typography>
              </CardContent>
            </Card>
          ))}
        </Box>
      </Container>

      <Container maxWidth="sm" sx={{ py: { xs: 6, md: 9 }, textAlign: 'center' }}>
        <Typography variant="h4" component="h2" sx={{ mb: 1 }}>Ready to track your bikes?</Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>Create an account in under a minute.</Typography>
        <Button size="large" variant="contained" component={RouterLink} to="/register">Create your account</Button>
      </Container>

      <Box component="footer" sx={{ py: 3, textAlign: 'center', borderTop: '1px solid', borderColor: 'divider', color: 'text.secondary' }}>
        <Typography variant="body2">© {new Date().getFullYear()} BikeLedger</Typography>
      </Box>
    </Box>
  );
}
