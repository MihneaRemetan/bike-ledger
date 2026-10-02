import { IconButton, Tooltip } from '@mui/material';
import DarkIcon from '@mui/icons-material/DarkModeOutlined';
import LightIcon from '@mui/icons-material/LightModeOutlined';
import { useColorMode } from '../ColorMode';

export default function ColorModeToggle(props) {
  const { mode, toggle } = useColorMode();
  const label = mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <Tooltip title={label}>
      <IconButton color="inherit" onClick={toggle} aria-label={label} {...props}>
        {mode === 'dark' ? <LightIcon /> : <DarkIcon />}
      </IconButton>
    </Tooltip>
  );
}
