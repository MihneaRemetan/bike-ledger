import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  AppBar, Avatar, Box, Divider, Drawer, IconButton, List, ListItemButton, ListItemIcon, ListItemText,
  Menu, MenuItem, Toolbar, Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import MenuIcon from '@mui/icons-material/Menu';
import DashboardIcon from '@mui/icons-material/SpaceDashboardOutlined';
import BikeIcon from '@mui/icons-material/PedalBikeOutlined';
import BuildIcon from '@mui/icons-material/SettingsSuggestOutlined';
import RouteIcon from '@mui/icons-material/RouteOutlined';
import ServiceIcon from '@mui/icons-material/HandymanOutlined';
import { useAuth } from '../auth/AuthContext';

const WIDTH = 230;
const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: <DashboardIcon /> },
  { to: '/bikes', label: 'Bikes', icon: <BikeIcon /> },
  { to: '/components', label: 'Components', icon: <BuildIcon /> },
  { to: '/rides', label: 'Rides', icon: <RouteIcon /> },
  { to: '/services', label: 'Services', icon: <ServiceIcon /> },
];

export default function Layout({ children }) {
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up('md'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [anchor, setAnchor] = useState(null);
  const { user, logout } = useAuth();
  const { pathname } = useLocation();

  const nav = (
    <Box sx={{ pt: 1 }}>
      <Toolbar />
      <List sx={{ px: 1 }}>
        {NAV.map((n) => (
          <ListItemButton
            key={n.to}
            component={NavLink}
            to={n.to}
            onClick={() => setMobileOpen(false)}
            selected={pathname.startsWith(n.to)}
            sx={{ borderRadius: 2, mb: 0.5, '&.Mui-selected': { bgcolor: 'primary.main', color: '#fff', '& .MuiListItemIcon-root': { color: '#fff' }, '&:hover': { bgcolor: 'primary.dark' } } }}
          >
            <ListItemIcon sx={{ minWidth: 38 }}>{n.icon}</ListItemIcon>
            <ListItemText primary={n.label} />
          </ListItemButton>
        ))}
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar position="fixed" color="primary" sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}>
        <Toolbar>
          {!desktop && (
            <IconButton color="inherit" edge="start" onClick={() => setMobileOpen(true)} sx={{ mr: 1 }} aria-label="Open menu">
              <MenuIcon />
            </IconButton>
          )}
          <BikeIcon sx={{ mr: 1, color: 'secondary.main' }} />
          <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 700 }}>BikeLedger</Typography>
          <IconButton onClick={(e) => setAnchor(e.currentTarget)} aria-label="User menu">
            <Avatar sx={{ width: 32, height: 32, bgcolor: 'secondary.main', color: '#000', fontSize: 14 }}>
              {user.name.slice(0, 1).toUpperCase()}
            </Avatar>
          </IconButton>
          <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
            <MenuItem disabled sx={{ opacity: '1 !important' }}>{user.name}</MenuItem>
            <Divider />
            <MenuItem onClick={logout}>Logout</MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Drawer
        variant={desktop ? 'permanent' : 'temporary'}
        open={desktop || mobileOpen}
        onClose={() => setMobileOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{ width: desktop ? WIDTH : 0, '& .MuiDrawer-paper': { width: WIDTH, boxSizing: 'border-box', bgcolor: 'background.default', borderRight: '1px solid #e4ded3' } }}
      >
        {nav}
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, p: { xs: 2, md: 3 } }}>
        <Toolbar />
        <Box sx={{ maxWidth: 1200, mx: 'auto' }}>{children}</Box>
      </Box>
    </Box>
  );
}
