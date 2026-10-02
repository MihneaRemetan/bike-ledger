import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert, Box, Card, CardContent, Link, MenuItem, Skeleton, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { BarChart } from '@mui/x-charts/BarChart';
import { api } from '../api/client';
import { useLoad } from '../lib/useLoad';
import { BIKE_TYPES, COMPONENT_TYPES, label } from '../lib/constants';
import { fmtDate, fmtDuration, fmtElev, fmtKm, fmtMoney } from '../lib/format';
import PageHeader from '../components/PageHeader';
import StatusChip from '../components/StatusChip';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthName = (m) => MONTHS[Number(m.slice(5)) - 1];
const perKm = (n) => (n == null ? '–' : `${fmtMoney(n)}/km`);

function Stat({ title, value, hint }) {
  return (
    <Card>
      <CardContent>
        <Typography variant="body2" color="text.secondary">{title}</Typography>
        <Typography variant="h6" sx={{ mt: 0.5 }}>{value}</Typography>
        {hint && <Typography variant="caption" color="text.secondary">{hint}</Typography>}
      </CardContent>
    </Card>
  );
}

function Record({ title, value, children }) {
  return (
    <Card>
      <CardContent>
        <Typography variant="body2" color="text.secondary">{title}</Typography>
        <Typography variant="h6" sx={{ mt: 0.5 }}>{value ?? '–'}</Typography>
        {children && <Typography variant="caption" color="text.secondary">{children}</Typography>}
      </CardContent>
    </Card>
  );
}

const grid = (cols) => ({ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: `repeat(${cols}, 1fr)` }, gap: 2, mb: 3 });

export default function Statistics() {
  const theme = useTheme();
  const [year, setYear] = useState('');
  const { data, loading, error } = useLoad(() => api('/stats/overview', { params: { year } }), [year]);

  if (error && !data) return <Alert severity="error">{error.message}</Alert>;
  if (!data) {
    return (
      <>
        <PageHeader title="Statistics" />
        <Skeleton variant="rounded" height={320} />
      </>
    );
  }

  const { summary: s, costs, months, bikes, records, parts } = data;
  const ride = (r) => r && `${r.title || 'Ride'} · ${fmtDate(r.date)} · ${r.bikeName}`;

  return (
    <>
      <PageHeader
        title="Statistics"
        subtitle="A yearly look at how much you rode, what it cost, and what each part gives you per km"
        actions={
          <TextField select size="small" label="Year" value={data.year} onChange={(e) => setYear(e.target.value)} sx={{ minWidth: 110 }} disabled={loading}>
            {data.years.map((y) => <MenuItem key={y} value={y}>{y}</MenuItem>)}
          </TextField>
        }
      />

      {s.rides === 0 && <Alert severity="info" sx={{ mb: 3 }}>No rides logged in {data.year}. Pick another year, or log a ride.</Alert>}

      <Box sx={grid(4)}>
        <Stat title="Distance" value={fmtKm(s.km)} hint={`${s.activeDays} days on the bike`} />
        <Stat title="Rides" value={s.rides} hint={`${fmtKm(s.avgDistanceKm)} on average`} />
        <Stat title="Moving time" value={`${fmtDuration(s.movingMin)} h`} hint={s.avgSpeedKmh ? `${s.avgSpeedKmh} km/h average` : 'No ride times logged'} />
        <Stat title="Elevation gain" value={fmtElev(s.elevationM)} />
      </Box>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6">What it cost in {data.year}</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 2, mt: 1.5 }}>
            <div><Typography variant="body2" color="text.secondary">Services</Typography><Typography fontWeight={600}>{fmtMoney(costs.services)}</Typography></div>
            <div><Typography variant="body2" color="text.secondary">Parts bought</Typography><Typography fontWeight={600}>{fmtMoney(costs.parts)}</Typography></div>
            <div><Typography variant="body2" color="text.secondary">Total</Typography><Typography fontWeight={600}>{fmtMoney(costs.total)}</Typography></div>
            <div><Typography variant="body2" color="text.secondary">Per kilometre</Typography><Typography fontWeight={600}>{perKm(costs.perKm)}</Typography></div>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
            Parts bought counts the price of parts installed this year; services are the costs you logged this year.
          </Typography>
        </CardContent>
      </Card>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 1 }}>Kilometres per month</Typography>
          <BarChart
            dataset={months.map((m) => ({ label: monthName(m.month), km: m.km }))}
            xAxis={[{ scaleType: 'band', dataKey: 'label' }]}
            series={[{ dataKey: 'km', label: 'km', color: theme.palette.primary.main, valueFormatter: (v) => `${v} km` }]}
            height={260}
            margin={{ left: 10, right: 10, top: 20, bottom: 30 }}
            slotProps={{ legend: { hidden: true } }}
          />
        </CardContent>
      </Card>

      <Typography variant="h6" sx={{ mb: 1.5 }}>Records of {data.year}</Typography>
      <Box sx={grid(4)}>
        <Record title="Longest ride" value={records.longestRide && fmtKm(records.longestRide.distanceKm)}>{ride(records.longestRide)}</Record>
        <Record title="Most climbing" value={records.mostElevation && fmtElev(records.mostElevation.elevationM)}>{ride(records.mostElevation)}</Record>
        <Record title="Fastest ride" value={records.fastestRide && `${records.fastestRide.avgSpeedKmh} km/h`}>{records.fastestRide ? ride(records.fastestRide) : 'Needs a ride of 10 km or more with a time'}</Record>
        <Record title="Best month" value={records.bestMonth && fmtKm(records.bestMonth.km)}>{records.bestMonth && `${monthName(records.bestMonth.month)} ${data.year}`}</Record>
      </Box>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 1 }}>By bike</Typography>
          {bikes.length === 0 ? <Typography color="text.secondary">No bikes yet.</Typography> : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow><TableCell>Bike</TableCell><TableCell align="right">Distance</TableCell><TableCell align="right">Rides</TableCell><TableCell align="right">Time</TableCell><TableCell align="right">Elevation</TableCell><TableCell align="right">Service cost</TableCell><TableCell align="right">Cost per km</TableCell></TableRow>
                </TableHead>
                <TableBody>
                  {bikes.map((b) => (
                    <TableRow key={b.id} hover>
                      <TableCell><Link component={RouterLink} to={`/bikes/${b.id}`}>{b.name}</Link> <Typography component="span" variant="caption" color="text.secondary">{label(BIKE_TYPES, b.type)}</Typography></TableCell>
                      <TableCell align="right">{fmtKm(b.km)}</TableCell>
                      <TableCell align="right">{b.rides}</TableCell>
                      <TableCell align="right">{fmtDuration(b.movingMin)} h</TableCell>
                      <TableCell align="right">{fmtElev(b.elevationM)}</TableCell>
                      <TableCell align="right">{fmtMoney(b.serviceCost)}</TableCell>
                      <TableCell align="right">{perKm(b.costPerKm)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6">Cost per km of each part</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Price divided by the kilometres the part has done so far. Only parts with a price are listed.</Typography>
          {parts.length === 0 ? <Typography color="text.secondary">Add a price to your parts to see this.</Typography> : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow><TableCell>Part</TableCell><TableCell>Bike</TableCell><TableCell align="right">Price</TableCell><TableCell align="right">Done so far</TableCell><TableCell align="right">Cost per km</TableCell><TableCell>Status</TableCell></TableRow>
                </TableHead>
                <TableBody>
                  {parts.map((p) => (
                    <TableRow key={p.id} hover>
                      <TableCell>{[label(COMPONENT_TYPES, p.type), p.brand].filter(Boolean).join(' · ')}</TableCell>
                      <TableCell>{p.bikeName}</TableCell>
                      <TableCell align="right">{fmtMoney(p.price)}</TableCell>
                      <TableCell align="right">{fmtKm(p.wearKm)}</TableCell>
                      <TableCell align="right">{perKm(p.costPerKm)}</TableCell>
                      <TableCell><StatusChip status={p.status} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>
    </>
  );
}
