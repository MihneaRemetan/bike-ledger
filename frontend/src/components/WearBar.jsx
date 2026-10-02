import { Box, LinearProgress, Typography } from '@mui/material';
import StatusChip from './StatusChip';

export default function WearBar({ component, hideChip }) {
  const { wearKm, maxKm, wearPct, status } = component;
  return (
    <Box sx={{ minWidth: 190 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <Typography variant="body2" color="text.secondary">
          {Math.round(wearKm)} / {Math.round(maxKm)} km ({Math.round(wearPct * 100)}%)
        </Typography>
        {!hideChip && <StatusChip status={status} />}
      </Box>
      <LinearProgress
        variant="determinate"
        value={Math.min(100, wearPct * 100)}
        sx={(t) => ({
          height: 8,
          borderRadius: 4,
          bgcolor: '#ece7dd',
          '& .MuiLinearProgress-bar': { bgcolor: t.palette.status[status], borderRadius: 4 },
        })}
      />
    </Box>
  );
}
