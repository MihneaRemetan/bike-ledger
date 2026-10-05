import { useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Chip, IconButton, Skeleton, Tooltip, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/EditOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutline';
import DoneIcon from '@mui/icons-material/CheckCircleOutline';
import { api } from '../api/client';
import { useLoad } from '../lib/useLoad';
import { COMPONENT_TYPES, SERVICE_TYPES, label } from '../lib/constants';
import { fmtDate } from '../lib/format';
import DeleteDialog from './DeleteDialog';
import RuleBar from './RuleBar';
import { useNotify } from './Notify';
import { RuleFormDialog } from './forms';

// Recurring maintenance of one bike: "clean the chain every 300 km", "inspection once a year"...
export default function MaintenanceSection({ bikeId, parts, onChanged }) {
  const notify = useNotify();
  const { data: rules, loading, error, reload } = useLoad(() => api('/maintenance/rules', { params: { bikeId } }), [bikeId]);
  const [form, setForm] = useState({ open: false, rule: null });
  const [del, setDel] = useState(null);
  const [busy, setBusy] = useState(false);

  const changed = () => { reload(); onChanged?.(); };
  const run = async (fn, success) => {
    setBusy(true);
    try {
      await fn();
      if (success) notify.success(success);
      changed();
    } catch (e) {
      notify.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 1 }}>
          <Typography variant="h6">Maintenance schedule</Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button size="small" disabled={busy} onClick={() => run(() => api('/maintenance/suggested', { method: 'POST', body: { bikeId } }), 'Suggested rules added')}>
              Add suggested rules
            </Button>
            <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setForm({ open: true, rule: null })}>Add rule</Button>
          </Box>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Reminders that repeat by distance or time. Press Done after you did the job, or log the service yourself: it restarts the counter.
        </Typography>

        {error && <Alert severity="error">{error.message}</Alert>}
        {loading && !rules && <Skeleton variant="rounded" height={80} />}
        {rules && rules.length === 0 && <Typography color="text.secondary">No rules yet. Add your own, or start with the suggested ones.</Typography>}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {(rules || []).map((r) => (
            <Box key={r.id} sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, justifyContent: 'space-between' }}>
              <Box sx={{ flex: '1 1 200px', minWidth: 0 }}>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Typography fontWeight={600}>{r.title}</Typography>
                  {r.componentType && <Chip size="small" variant="outlined" label={label(COMPONENT_TYPES, r.componentType)} />}
                </Box>
                <Typography variant="caption" color="text.secondary">
                  {label(SERVICE_TYPES, r.serviceType)} · {r.lastServiceAt && r.lastServiceAt >= r.startDate ? `last done ${fmtDate(r.lastServiceAt)}` : `counting from ${fmtDate(r.startDate)}`}
                  {r.forecast ? ` · expected ${fmtDate(r.forecast.date)}` : r.nextDueDate ? ` · next by ${fmtDate(r.nextDueDate)}` : ''}
                </Typography>
              </Box>
              <Box sx={{ flex: '1 1 240px', maxWidth: 360 }}><RuleBar rule={r} /></Box>
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <Tooltip title="Log this job as done today">
                  <span>
                    <Button size="small" startIcon={<DoneIcon />} disabled={busy || r.status === 'PAUSED'}
                      onClick={() => run(() => api(`/maintenance/rules/${r.id}/complete`, { method: 'POST', body: {} }), `"${r.title}" marked as done`)}>
                      Done
                    </Button>
                  </span>
                </Tooltip>
                <IconButton size="small" aria-label={`Edit ${r.title}`} onClick={() => setForm({ open: true, rule: r })}><EditIcon fontSize="small" /></IconButton>
                <IconButton size="small" aria-label={`Delete ${r.title}`} onClick={() => setDel(r)}><DeleteIcon fontSize="small" /></IconButton>
              </Box>
            </Box>
          ))}
        </Box>
      </CardContent>

      <RuleFormDialog open={form.open} rule={form.rule} bikeId={bikeId} parts={parts} onClose={() => setForm({ open: false, rule: null })} onSaved={() => { setForm({ open: false, rule: null }); changed(); }} />
      <DeleteDialog
        item={del}
        path="/maintenance/rules"
        title="Delete rule?"
        text={(r) => `"${r.title}" will stop reminding you. Services you already logged are kept.`}
        deletedMessage="Rule deleted"
        onClose={() => setDel(null)}
        onDeleted={changed}
      />
    </Card>
  );
}
