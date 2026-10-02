import { Box, LinearProgress, Typography } from '@mui/material';
import { fmtDate, fmtIn } from '../lib/format';
import StatusChip from './StatusChip';

// One line under the bar: when the part is expected to reach its limit, at the recent riding pace
function ForecastLine({ forecast }) {
  let text;
  if (forecast.status === 'DATE') text = `Limit expected ${fmtDate(forecast.date)} (${fmtIn(forecast.daysLeft)})`;
  else if (forecast.status === 'NOW') text = 'Limit reached';
  else if (forecast.status === 'FAR') text = 'Limit is years away at your pace';
  else text = 'No recent rides to estimate a date';
  return (
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }} title={`Based on ${forecast.kmPerDay} km/day over the last ${forecast.windowDays} days`}>
      {text}
    </Typography>
  );
}

export default function WearBar({ component, hideChip, hideForecast }) {
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
          bgcolor: t.palette.track,
          '& .MuiLinearProgress-bar': { bgcolor: t.palette.status[status], borderRadius: 4 },
        })}
      />
      {!hideForecast && component.forecast && <ForecastLine forecast={component.forecast} />}
    </Box>
  );
}
