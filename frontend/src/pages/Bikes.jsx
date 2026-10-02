import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Box, Button, Card, CardActions, CardContent, Chip, Skeleton, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import BikeIcon from '@mui/icons-material/PedalBikeOutlined';
import WarningIcon from '@mui/icons-material/WarningAmberRounded';
import { api } from '../api/client';
import { useLoad } from '../lib/useLoad';
import { BIKE_TYPES, label } from '../lib/constants';
import { fmtKm, fmtMoney } from '../lib/format';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import ConfirmDialog from '../components/ConfirmDialog';
import { useNotify } from '../components/Notify';
import { BikeFormDialog } from '../components/forms';

export default function Bikes() {
  const navigate = useNavigate();
  const notify = useNotify();
  const { data: bikes, loading, error, reload } = useLoad(() => api('/bikes'), []);
  const [form, setForm] = useState({ open: false, bike: null });
  const [del, setDel] = useState(null);

  const closeForm = () => setForm({ open: false, bike: null });

  return (
    <>
      <PageHeader title="Bikes" subtitle="Your bikes. Open one to see its parts, rides and service history." actions={<Button variant="contained" startIcon={<AddIcon />} onClick={() => setForm({ open: true, bike: null })}>Add bike</Button>} />
      {error && <Alert severity="error">{error.message}</Alert>}
      {loading && !bikes && <Skeleton variant="rounded" height={180} />}
      {bikes && bikes.length === 0 && (
        <Card><EmptyState icon={<BikeIcon />} title="No bikes yet" text="Add a bike to start logging rides and parts." actionLabel="Add bike" onAction={() => setForm({ open: true, bike: null })} /></Card>
      )}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' }, gap: 2 }}>
        {(bikes || []).map((b) => (
          <Card key={b.id} sx={{ display: 'flex', flexDirection: 'column' }}>
            <CardContent sx={{ flexGrow: 1 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
                <Typography variant="h6">{b.name}</Typography>
                <Chip size="small" label={label(BIKE_TYPES, b.type)} color="primary" variant="outlined" />
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {[b.brand, b.model, b.year].filter(Boolean).join(' · ') || 'No details'}
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
                <Stat k="Distance" v={fmtKm(b.totalKm)} />
                <Stat k="Rides" v={b.rideCount} />
                <Stat k="Cost" v={fmtMoney(b.maintenanceCost)} />
              </Box>
              {b.alerts > 0 && (
                <Chip sx={{ mt: 2 }} size="small" icon={<WarningIcon />} label={`${b.alerts} part${b.alerts > 1 ? 's' : ''} need attention`}
                  color="warning" />
              )}
            </CardContent>
            <CardActions sx={{ px: 2, pb: 2 }}>
              <Button size="small" variant="contained" onClick={() => navigate(`/bikes/${b.id}`)}>Open</Button>
              <Button size="small" onClick={() => setForm({ open: true, bike: b })}>Edit</Button>
              <Button size="small" color="error" onClick={() => setDel(b)}>Delete</Button>
            </CardActions>
          </Card>
        ))}
      </Box>

      <BikeFormDialog open={form.open} bike={form.bike} onClose={closeForm} onSaved={() => { closeForm(); reload(); }} />
      <ConfirmDialog
        open={Boolean(del)}
        title="Delete bike?"
        text={`"${del?.name}" and all its components, rides and services will be permanently deleted.`}
        onClose={() => setDel(null)}
        onConfirm={async () => {
          try {
            await api(`/bikes/${del.id}`, { method: 'DELETE' });
            notify.success('Bike deleted');
            setDel(null);
            reload();
          } catch (e) {
            notify.error(e.message);
          }
        }}
      />
    </>
  );
}

function Stat({ k, v }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">{k}</Typography>
      <Typography variant="body2" fontWeight={600}>{v}</Typography>
    </Box>
  );
}
