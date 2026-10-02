import { useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import {
  Alert, Box, Button, Card, CardContent, Chip, Collapse, IconButton, Skeleton, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/EditOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutline';
import SwapIcon from '@mui/icons-material/SwapHorizOutlined';
import UploadIcon from '@mui/icons-material/UploadFileOutlined';
import ExpandIcon from '@mui/icons-material/ExpandMore';
import { api } from '../api/client';
import { useLoad } from '../lib/useLoad';
import { BIKE_TYPES, COMPONENT_TYPES, SERVICE_TYPES, label } from '../lib/constants';
import { fmtDate, fmtDuration, fmtKm, fmtMoney } from '../lib/format';
import PageHeader from '../components/PageHeader';
import ConfirmDialog from '../components/ConfirmDialog';
import WearBar from '../components/WearBar';
import StatusChip from '../components/StatusChip';
import GpxImportDialog from '../components/GpxImportDialog';
import { useNotify } from '../components/Notify';
import { BikeFormDialog, ComponentFormDialog, RideFormDialog, ServiceFormDialog } from '../components/forms';

const partName = (c) => [label(COMPONENT_TYPES, c.type), [c.brand, c.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ');

function Section({ title, actions, children }) {
  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 2 }}>
          <Typography variant="h6">{title}</Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>{actions}</Box>
        </Box>
        {children}
      </CardContent>
    </Card>
  );
}

export default function BikeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const notify = useNotify();
  const { data: bike, loading, error, reload } = useLoad(() => api(`/bikes/${id}`), [id]);
  const { data: bikes } = useLoad(() => api('/bikes'), []);
  const [dlg, setDlg] = useState(null); // { kind, item, preset }
  const [del, setDel] = useState(null); // { kind, item }
  const [showRetired, setShowRetired] = useState(false);

  if (error) return <Alert severity="error">{error.status === 404 ? 'Bike not found' : error.message}</Alert>;
  if (loading && !bike) return <Skeleton variant="rounded" height={300} />;

  const close = () => setDlg(null);
  const saved = () => { close(); reload(); };
  const active = bike.components.filter((c) => !c.retiredAt);
  const retired = bike.components.filter((c) => c.retiredAt);

  const paths = { bike: '/bikes', component: '/components', ride: '/rides', service: '/services' };
  const doDelete = async () => {
    try {
      await api(`${paths[del.kind]}/${del.item.id}`, { method: 'DELETE' });
      notify.success('Deleted');
      const wasBike = del.kind === 'bike';
      setDel(null);
      if (wasBike) navigate('/bikes');
      else reload();
    } catch (e) {
      notify.error(e.message);
    }
  };

  const rowActions = (kind, item) => (
    <>
      <IconButton size="small" aria-label="Edit" onClick={() => setDlg({ kind, item })}><EditIcon fontSize="small" /></IconButton>
      <IconButton size="small" aria-label="Delete" onClick={() => setDel({ kind, item })}><DeleteIcon fontSize="small" /></IconButton>
    </>
  );

  return (
    <>
      <PageHeader
        title={bike.name}
        subtitle={[label(BIKE_TYPES, bike.type), bike.brand, bike.model, bike.year].filter(Boolean).join(' · ')}
        actions={
          <>
            <Button startIcon={<EditIcon />} onClick={() => setDlg({ kind: 'bike', item: bike })}>Edit</Button>
            <Button color="error" startIcon={<DeleteIcon />} onClick={() => setDel({ kind: 'bike', item: bike })}>Delete</Button>
          </>
        }
      />
      {bike.notes && <Typography color="text.secondary" sx={{ mb: 2 }}>{bike.notes}</Typography>}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 2, mb: 3 }}>
        {[['Total distance', fmtKm(bike.totalKm)], ['Rides', bike.rideCount], ['Maintenance cost', fmtMoney(bike.maintenanceCost)], ['Cost per km', `${fmtMoney(bike.costPerKm)}/km`]].map(([k, v]) => (
          <Card key={k}><CardContent>
            <Typography variant="body2" color="text.secondary">{k}</Typography>
            <Typography variant="h6">{v}</Typography>
          </CardContent></Card>
        ))}
      </Box>

      <Section title="Components" actions={<Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setDlg({ kind: 'component' })}>Add component</Button>}>
        {active.length === 0 ? (
          <Typography color="text.secondary">No active components. Add the parts mounted on this bike to track their wear.</Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {active.map((c) => (
              <Box key={c.id} sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, justifyContent: 'space-between' }}>
                <Box sx={{ flex: '1 1 160px' }}>
                  <Typography fontWeight={600}>{partName(c)}</Typography>
                  <Typography variant="caption" color="text.secondary">Installed {fmtDate(c.installedAt)}</Typography>
                </Box>
                <Box sx={{ flex: '1 1 240px', maxWidth: 360 }}><WearBar component={c} /></Box>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <Tooltip title="Replace this part">
                    <Button size="small" startIcon={<SwapIcon />} onClick={() => setDlg({ kind: 'service', preset: { bikeId: bike.id, componentId: c.id, type: 'REPLACE' } })}>Replace</Button>
                  </Tooltip>
                  {rowActions('component', c)}
                </Box>
              </Box>
            ))}
          </Box>
        )}
        {retired.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <Button size="small" onClick={() => setShowRetired(!showRetired)} endIcon={<ExpandIcon sx={{ transform: showRetired ? 'rotate(180deg)' : 'none' }} />}>
              Retired parts ({retired.length})
            </Button>
            <Collapse in={showRetired}>
              <TableContainer>
                <Table size="small">
                  <TableHead><TableRow><TableCell>Part</TableCell><TableCell>Installed</TableCell><TableCell>Retired</TableCell><TableCell>Final wear</TableCell><TableCell /></TableRow></TableHead>
                  <TableBody>
                    {retired.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>{partName(c)}</TableCell>
                        <TableCell>{fmtDate(c.installedAt)}</TableCell>
                        <TableCell>{fmtDate(c.retiredAt)}</TableCell>
                        <TableCell>{Math.round(c.wearKm)} km</TableCell>
                        <TableCell align="right">{rowActions('component', c)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Collapse>
          </Box>
        )}
      </Section>

      <Section
        title="Recent rides"
        actions={
          <>
            <Button size="small" startIcon={<UploadIcon />} onClick={() => setDlg({ kind: 'gpx' })}>Import GPX</Button>
            <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setDlg({ kind: 'ride' })}>Add ride</Button>
          </>
        }
      >
        {bike.recentRides.length === 0 ? <Typography color="text.secondary">No rides logged yet.</Typography> : (
          <TableContainer>
            <Table size="small">
              <TableHead><TableRow><TableCell>Date</TableCell><TableCell>Title</TableCell><TableCell align="right">Distance</TableCell><TableCell align="right">Duration</TableCell><TableCell>Source</TableCell><TableCell /></TableRow></TableHead>
              <TableBody>
                {bike.recentRides.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{fmtDate(r.date)}</TableCell>
                    <TableCell>{r.title || '–'}</TableCell>
                    <TableCell align="right">{fmtKm(r.distanceKm)}</TableCell>
                    <TableCell align="right">{fmtDuration(r.durationMin)}</TableCell>
                    <TableCell><Chip size="small" label={r.source === 'GPX' ? 'GPX' : 'Manual'} variant="outlined" /></TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{rowActions('ride', r)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        <Button component={RouterLink} to="/rides" size="small" sx={{ mt: 1 }}>All rides</Button>
      </Section>

      <Section title="Service history" actions={<Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setDlg({ kind: 'service', preset: { bikeId: bike.id } })}>Log service</Button>}>
        {bike.recentServices.length === 0 ? <Typography color="text.secondary">No services logged yet.</Typography> : (
          <TableContainer>
            <Table size="small">
              <TableHead><TableRow><TableCell>Date</TableCell><TableCell>Type</TableCell><TableCell>Component</TableCell><TableCell align="right">Cost</TableCell><TableCell>Notes</TableCell><TableCell /></TableRow></TableHead>
              <TableBody>
                {bike.recentServices.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{fmtDate(s.date)}</TableCell>
                    <TableCell><Chip size="small" label={label(SERVICE_TYPES, s.type)} /></TableCell>
                    <TableCell>{s.componentType ? partName({ type: s.componentType, brand: s.componentBrand, model: s.componentModel }) : '–'}</TableCell>
                    <TableCell align="right">{fmtMoney(s.cost)}</TableCell>
                    <TableCell sx={{ maxWidth: 260 }}>{s.notes || '–'}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{rowActions('service', s)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Section>

      <BikeFormDialog open={dlg?.kind === 'bike'} bike={dlg?.item} onClose={close} onSaved={saved} />
      <ComponentFormDialog open={dlg?.kind === 'component'} component={dlg?.item} bikes={bikes} defaultBikeId={bike.id} onClose={close} onSaved={saved} />
      <RideFormDialog open={dlg?.kind === 'ride'} ride={dlg?.item} bikes={bikes} defaultBikeId={bike.id} onClose={close} onSaved={saved} />
      <ServiceFormDialog open={dlg?.kind === 'service'} service={dlg?.item} preset={dlg?.preset} bikes={bikes} onClose={close} onSaved={saved} />
      <GpxImportDialog open={dlg?.kind === 'gpx'} bikes={bikes} defaultBikeId={bike.id} onClose={close} onSaved={saved} />
      <ConfirmDialog
        open={Boolean(del)}
        title="Delete?"
        text={del?.kind === 'bike' ? `"${bike.name}" and everything on it will be permanently deleted.` : 'This cannot be undone.'}
        onClose={() => setDel(null)}
        onConfirm={doDelete}
      />
    </>
  );
}
