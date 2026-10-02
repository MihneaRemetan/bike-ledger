import { useState } from 'react';
import { Divider, IconButton, ListItemText, Menu, MenuItem, Tooltip, Typography } from '@mui/material';
import CartIcon from '@mui/icons-material/ShoppingCartOutlined';
import { Link as RouterLink } from 'react-router-dom';
import { buyLinks } from '../lib/shopping';

// A cart button that lists places to buy this kind of part. The icon turns attention-coloured when the part is worn.
export default function BuyMenu({ component, bikeType }) {
  const [anchor, setAnchor] = useState(null);
  const { terms, links } = buyLinks(component, bikeType);
  const urgent = component.status === 'WARN' || component.status === 'REPLACE';
  return (
    <>
      <Tooltip title="Find a replacement online">
        <IconButton size="small" aria-label="Buy a replacement" color={urgent ? 'warning' : 'default'} onClick={(e) => setAnchor(e.currentTarget)}>
          <CartIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <Typography variant="caption" color="text.secondary" sx={{ px: 2, display: 'block', maxWidth: 260 }}>
          Search for “{terms}”
        </Typography>
        {links.map((l) => (
          <MenuItem key={l.name} component="a" href={l.url} target="_blank" rel="noopener noreferrer" onClick={() => setAnchor(null)}>
            <ListItemText primary={l.name} />
          </MenuItem>
        ))}
        <Divider />
        <MenuItem component={RouterLink} to="/map" onClick={() => setAnchor(null)}>
          <ListItemText primary="Bike shops near me" secondary="Open the map" />
        </MenuItem>
        <Typography variant="caption" color="text.secondary" sx={{ px: 2, pt: 0.5, display: 'block', maxWidth: 260 }}>
          These open a search in a new tab. BikeLedger earns nothing from them.
        </Typography>
      </Menu>
    </>
  );
}
