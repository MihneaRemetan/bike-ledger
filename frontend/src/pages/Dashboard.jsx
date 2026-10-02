import { useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { Alert, Box, Card, CardContent, Link, Skeleton, Typography } from '@mui/material';
import { BarChart } from '@mui/x-charts/BarChart';
import { api } from '../api/client';
import { useLoad } from '../lib/useLoad';
import { COMPONENT_TYPES, label } from '../lib/constants';
import { fmtKm, fmtMoney } from '../lib/format';
import PageHeader from '../components/PageHeader';
import PhotoBanner from '../components/PhotoBanner';
import GettingStarted from '../components/GettingStarted';
import { useAuth } from '../auth/AuthContext';
import WearBar from '../components/WearBar';
import { BikeFormDialog } from '../components/forms';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (m) => `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(2, 4)}`;

function Kpi({ title, value, color }) {
  return (
    <Card>
      <CardContent>
        <Typography variant="body2" color="text.secondary">{title}</Typography>
        <Typography variant="h5" sx={{ mt: 0.5, color }}>{value}</Typography>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { data, loading, error, reload } = useLoad(() => api('/stats/dashboard'), []);
  const [addBike, setAddBike] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();

  if (error) return <Alert severity="error">{error.message}</Alert>;
  if (loading && !data) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 2 }}>
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} variant="rounded" height={90} />)}
        </Box>
        <Skeleton variant="rounded" height={300} sx={{ mt: 2 }} />
      </>
    );
  }

  const { totals, months, alerts } = data;
  const steps = [
    { title: 'Add your bike', text: 'Give it a name and a type. You can add more bikes later.', action: 'Add bike', done: totals.bikes > 0, onClick: () => setAddBike(true) },
    { title: 'Add the parts mounted on it', text: 'Chain, tyres, brake pads and so on. Each part gets a wear limit in km, suggested for you.', action: 'Add parts', done: totals.activeComponents > 0, onClick: () => navigate('/components') },
    { title: 'Log a ride', text: 'Enter it by hand or import a GPX file. Its distance is added to every part mounted at that time.', action: 'Log a ride', done: totals.rides > 0, onClick: () => navigate('/rides') },
  ];
  const onboarding = steps.some((st) => !st.done);
  const bikeDialog = <BikeFormDialog open={addBike} onClose={() => setAddBike(false)} onSaved={() => { setAddBike(false); reload(); }} />;

  if (totals.bikes === 0) {
    return (
      <>
        <PhotoBanner image="/images/welcome.jpg" title={`Welcome, ${user.name.split(' ')[0]}`} subtitle="Let's set up your first bike. It only takes a minute." />
        <GettingStarted steps={steps} />
        {bikeDialog}
      </>
    );
  }

  const dataset = months.map((m) => ({ label: monthLabel(m.month), km: m.km }));
  return (
    <>
      <PageHeader title="Dashboard" subtitle="Your riding and maintenance at a glance" />
      {onboarding && <GettingStarted steps={steps} />}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 2, mb: 3 }}>
        <Kpi title="Total distance" value={fmtKm(totals.km)} />
        <Kpi title="Rides" value={totals.rides} />
        <Kpi title="Maintenance cost" value={fmtMoney(totals.maintenanceCost)} />
        <Kpi title="Parts needing attention" value={alerts.length} color={alerts.length ? 'status.WARN' : 'status.OK'} />
      </Box>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 1 }}>Kilometres per month</Typography>
          <BarChart
            dataset={dataset}
            xAxis={[{ scaleType: 'band', dataKey: 'label' }]}
            series={[{ dataKey: 'km', label: 'km', color: '#1f5c4a', valueFormatter: (v) => `${v} km` }]}
            height={280}
            margin={{ left: 10, right: 10, top: 20, bottom: 30 }}
            slotProps={{ legend: { hidden: true } }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>Wear alerts</Typography>
          {alerts.length === 0 ? (
            <Typography color="text.secondary">All components are in good shape.</Typography>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {alerts.map((c) => (
                <Box key={c.id} sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
                  <Box>
                    <Typography fontWeight={600}>{label(COMPONENT_TYPES, c.type)}{c.brand ? ` · ${c.brand}` : ''}</Typography>
                    <Link component={RouterLink} to={`/bikes/${c.bikeId}`} variant="body2">{c.bikeName}</Link>
                  </Box>
                  <Box sx={{ flex: '1 1 240px', maxWidth: 380 }}><WearBar component={c} /></Box>
                </Box>
              ))}
            </Box>
          )}
        </CardContent>
      </Card>
      {bikeDialog}
    </>
  );
}
