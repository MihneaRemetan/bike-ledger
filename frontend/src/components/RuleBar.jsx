import { Box, LinearProgress, Typography } from '@mui/material';
import { RULE_STATUS_COLOR } from '../lib/constants';
import StatusChip from './StatusChip';

// Progress of a maintenance rule: how much of its distance and/or time interval is used up
export default function RuleBar({ rule, hideChip }) {
  const used = [];
  if (rule.everyKm) used.push(`${Math.round(rule.kmSince)} / ${Math.round(rule.everyKm)} km`);
  if (rule.everyDays) used.push(`${rule.daysSince} / ${rule.everyDays} days`);
  const color = RULE_STATUS_COLOR[rule.status];
  return (
    <Box sx={{ minWidth: 190 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <Typography variant="body2" color="text.secondary">{used.join(' · ')}</Typography>
        {!hideChip && <StatusChip rule status={rule.status} />}
      </Box>
      <LinearProgress
        variant="determinate"
        value={Math.min(100, rule.pct * 100)}
        aria-label={`${rule.title} progress`}
        sx={(t) => ({
          height: 8, borderRadius: 4, bgcolor: t.palette.track,
          '& .MuiLinearProgress-bar': { bgcolor: t.palette.status[color], borderRadius: 4 },
        })}
      />
    </Box>
  );
}
