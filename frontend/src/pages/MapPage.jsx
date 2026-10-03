import { useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import L from 'leaflet';
import { Circle, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Alert, Box, Button, Card, CardContent, Chip, CircularProgress, FormControlLabel, Link, Skeleton, Switch, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import StoreIcon from '@mui/icons-material/StorefrontOutlined';
import LocationIcon from '@mui/icons-material/MyLocationOutlined';
import { api } from '../api/client';
import { useTheme } from '@mui/material/styles';
import { useLoad } from '../lib/useLoad';
import { fmtDate, fmtKm } from '../lib/format';
import PageHeader from '../components/PageHeader';
import BikeFilter from '../components/BikeFilter';
import HeatLayer, { STOPS, STOPS_DARK } from '../components/HeatLayer';

const PALETTE = ['#1f5c4a', '#e07b00', '#2563a8', '#b8338a', '#6b7a1f', '#c62828'];
const PALETTE_DARK = ['#5bbf9f', '#ffa94d', '#6cb0ff', '#e879c0', '#b5c94a', '#ff6b6b'];

// Map pin for bike shops; amber when the shop is tagged as doing repairs. divIcon avoids bundling Leaflet's PNG icons.
const pin = (color) =>
  L.divIcon({
    className: '',
    html: `<svg width="30" height="38" viewBox="0 0 30 38" xmlns="http://www.w3.org/2000/svg"><path d="M15 1C7.8 1 2 6.8 2 14c0 9.6 13 23 13 23s13-13.4 13-23C28 6.8 22.2 1 15 1z" fill="${color}" stroke="#fff" stroke-width="2"/><circle cx="15" cy="14" r="5.5" fill="#fff"/></svg>`,
    iconSize: [30, 38],
    iconAnchor: [15, 36],
    popupAnchor: [0, -32],
  });
// Blue dot marking where the search starts. Draggable so a wrong location can be corrected.
const SEARCH_DOT = L.divIcon({
  className: '',
  html: '<div style="width:20px;height:20px;border-radius:50%;background:#2563a8;border:3px solid #fff;box-shadow:0 0 0 3px rgba(37,99,168,.45);cursor:grab"></div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});
const REPAIR_PIN = pin('#e8a33d');
const SHOP_PIN = pin('#5f7a8a');

function FitBounds({ routes, focusId }) {
  const map = useMap();
  useEffect(() => {
    const focus = routes.find((r) => r.id === focusId);
    const pts = focus ? focus.points : routes.flatMap((r) => r.points);
    if (!pts.length) return undefined;
    // Fit only once the container has a real size; with a 0x0 size Leaflet would pick the maximum zoom
    let tries = 0;
    let timer;
    const fit = () => {
      map.invalidateSize(false);
      const { x, y } = map.getSize();
      if ((x === 0 || y === 0) && tries++ < 40) {
        timer = setTimeout(fit, 100);
        return;
      }
      map.fitBounds(pts, { padding: [30, 30], maxZoom: 14, animate: false });
    };
    timer = setTimeout(fit, 50);
    return () => clearTimeout(timer);
  }, [routes, focusId, map]);
  return null;
}

export default function MapPage() {
  const [params] = useSearchParams();
  const highlight = Number(params.get('ride')) || null;
  const [bikeId, setBikeId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [active, setActive] = useState(highlight);
  const [showRoutes, setShowRoutes] = useState(true);
  const [style, setStyle] = useState('bike'); // 'bike': a colour per bike, 'heat': a heatmap of how often you rode each street
  const dark = useTheme().palette.mode === 'dark';
  const colors = dark ? PALETTE_DARK : PALETTE;
  const { data: bikes } = useLoad(() => api('/bikes'), []);
  const { data: routes, loading, error } = useLoad(() => api('/rides/routes', { params: { bikeId, from, to, limit: 500 } }), [bikeId, from, to]);

  const colorOf = useMemo(() => {
    const m = new Map((bikes || []).map((b, i) => [b.id, colors[i % colors.length]]));
    return (id) => m.get(id) || colors[0];
  }, [bikes, colors]);

  const totalKm = (routes || []).reduce((s, r) => s + r.distanceKm, 0);
  const usedBikes = (bikes || []).filter((b) => (routes || []).some((r) => r.bikeId === b.id));

  // Nearby bike shops (OpenStreetMap data)
  const [map, setMap] = useState(null);
  const [shops, setShops] = useState(null); // { center, radiusKm, list }
  const [shopsLoading, setShopsLoading] = useState(false);
  const [shopsError, setShopsError] = useState('');

  const lastSearch = useRef(null);
  const searchShops = async (lat, lon, radiusKm, meta = {}) => {
    lastSearch.current = [lat, lon, radiusKm, meta];
    setShopsLoading(true);
    setShopsError('');
    try {
      const list = await api('/places/bike-shops', { params: { lat, lon, radiusKm } });
      setShops({ center: [lat, lon], radiusKm, list, ...meta });
      // Zoom to the results so the pins are not piled up at the current zoom level
      if (list.length && map) map.fitBounds([[lat, lon], ...list.map((sh) => [sh.lat, sh.lon])], { padding: [40, 40], maxZoom: 15 });
    } catch (e) {
      setShopsError(e.message);
    } finally {
      setShopsLoading(false);
    }
  };

  const searchHere = () => {
    if (!map) return;
    const c = map.getCenter();
    const edgeKm = map.distance(c, map.getBounds().getNorthEast()) / 1000;
    searchShops(c.lat, c.lng, Math.min(30, Math.max(2, Math.round(edgeKm))), { source: 'area' });
  };

  const searchNearMe = () => {
    if (!navigator.geolocation) {
      setShopsError('Your browser does not support location.');
      return;
    }
    setShopsLoading(true);
    setShopsError('');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        map?.setView([coords.latitude, coords.longitude], 13);
        searchShops(coords.latitude, coords.longitude, 8, { source: 'location', accuracyM: coords.accuracy });
      },
      () => {
        setShopsLoading(false);
        setShopsError('Could not get your location. Allow location access, or move the map and use "Find bike shops in this area".');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };


  return (
    <>
      <PageHeader title="Map" subtitle="All the routes you imported from GPX or TCX files, for example from Strava or Garmin." />
      <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <BikeFilter bikes={bikes} value={bikeId} onChange={setBikeId} />
        <TextField size="small" type="date" label="From" value={from} onChange={(e) => setFrom(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
        <TextField size="small" type="date" label="To" value={to} onChange={(e) => setTo(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
        {routes && routes.length > 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ ml: { md: 'auto' } }}>
            {routes.length} route{routes.length > 1 ? 's' : ''} · {fmtKm(totalKm)}
          </Typography>
        )}
      </Box>
      {error && <Alert severity="error">{error.message}</Alert>}
      {loading && !routes && <Skeleton variant="rounded" height={460} />}
      {routes && routes.length === 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          No routes yet. Import a GPX file on the <Link component={RouterLink} to="/rides">Rides</Link> page and it will show up here.
          On Strava: open an activity, click the three dots menu, then Export GPX. You can still look for bike shops below.
        </Alert>
      )}
      {routes && (
        <>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mb: 1.5 }}>
            {showRoutes && style === 'bike' && usedBikes.map((b) => (
              <Chip key={b.id} size="small" label={b.name} sx={{ bgcolor: colorOf(b.id), color: dark ? '#000' : '#fff', fontWeight: 600 }} />
            ))}
            <FormControlLabel
              sx={{ ml: 0.5, mr: 0 }}
              control={<Switch size="small" checked={showRoutes} onChange={(e) => setShowRoutes(e.target.checked)} />}
              label={<Typography variant="body2">Show routes</Typography>}
            />
            {showRoutes && (
              <ToggleButtonGroup size="small" exclusive value={style} onChange={(_, v) => v && setStyle(v)} aria-label="Route style">
                <ToggleButton value="bike">By bike</ToggleButton>
                <ToggleButton value="heat">Heatmap</ToggleButton>
              </ToggleButtonGroup>
            )}
            <Box sx={{ flexGrow: 1 }} />
            <Button size="small" variant="contained" color="secondary" startIcon={shopsLoading ? <CircularProgress size={16} color="inherit" /> : <StoreIcon />} onClick={searchHere} disabled={shopsLoading || !map} sx={{ color: '#000' }}>
              Find bike shops in this area
            </Button>
            <Button size="small" variant="outlined" startIcon={<LocationIcon />} onClick={searchNearMe} disabled={shopsLoading || !map}>
              My Location
            </Button>
            {shops && <Button size="small" onClick={() => setShops(null)}>Hide shops</Button>}
          </Box>
          {shops && shops.source === 'location' && shops.accuracyM > 1000 && !shopsLoading && (
            <Alert severity="warning" sx={{ mb: 1.5 }}>
              Your browser placed you with an accuracy of about {Math.round(shops.accuracyM / 100) / 10} km (computers estimate location from Wi-Fi or IP,
              phones with GPS are more exact). If the blue dot is in the wrong place, drag it to your real position and the search repeats from there.
            </Alert>
          )}
          {shopsLoading && (
            <Alert severity="info" icon={<CircularProgress size={18} />} sx={{ mb: 1.5 }}>
              Searching for bike shops. The free map data service can be slow, this may take up to half a minute.
            </Alert>
          )}
          {shopsError && (
            <Alert
              severity="warning"
              sx={{ mb: 1.5 }}
              onClose={() => setShopsError('')}
              action={lastSearch.current && (
                <Button color="inherit" size="small" onClick={() => searchShops(...lastSearch.current)}>Try again</Button>
              )}
            >
              {shopsError}
            </Alert>
          )}
          <Card sx={{ overflow: 'hidden', '& .leaflet-tile-pane': dark ? { filter: 'invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.9)' } : {}, '& .leaflet-container': { bgcolor: dark ? '#1a1f1d' : undefined } }}>
            <MapContainer ref={setMap} center={[45.9, 25]} zoom={6} style={{ height: 'min(70vh, 640px)', width: '100%' }} scrollWheelZoom>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <FitBounds routes={routes} focusId={highlight} />
              {showRoutes && style === 'heat' && <HeatLayer routes={routes} dark={dark} />}
              {showRoutes && style === 'bike' && routes.map((r) => (
                <Polyline
                  key={r.id}
                  positions={r.points}
                  pathOptions={{ color: colorOf(r.bikeId), weight: active === r.id ? 6 : 3, opacity: active && active !== r.id ? 0.35 : 0.8 }}
                  eventHandlers={{ click: () => setActive(r.id), mouseover: (e) => e.target.setStyle({ weight: 6 }), mouseout: (e) => e.target.setStyle({ weight: active === r.id ? 6 : 3 }) }}
                >
                  <Popup>
                    <strong>{r.title || 'Ride'}</strong><br />
                    {fmtDate(r.date)} · {fmtKm(r.distanceKm)}<br />
                    <Link component={RouterLink} to={`/bikes/${r.bikeId}`}>{r.bikeName}</Link>
                  </Popup>
                </Polyline>
              ))}
              {shops && shops.accuracyM > 0 && (
                <Circle center={shops.center} radius={shops.accuracyM} pathOptions={{ color: '#2563a8', weight: 1, fillColor: '#2563a8', fillOpacity: 0.1 }} interactive={false} />
              )}
              {shops && (
                <Marker
                  position={shops.center}
                  icon={SEARCH_DOT}
                  draggable
                  zIndexOffset={1000}
                  eventHandlers={{
                    dragend: (e) => {
                      const { lat, lng } = e.target.getLatLng();
                      searchShops(lat, lng, shops.radiusKm, { source: 'moved' });
                    },
                  }}
                >
                  <Tooltip direction="top" offset={[0, -10]}>Search point: drag to search somewhere else</Tooltip>
                </Marker>
              )}
              {shops && shops.list.map((sh) => (
                <Marker key={sh.id} position={[sh.lat, sh.lon]} icon={sh.repair ? REPAIR_PIN : SHOP_PIN}>
                  <Popup><ShopDetails shop={sh} /></Popup>
                </Marker>
              ))}
            </MapContainer>
          </Card>
          {showRoutes && style === 'heat' && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.5 }} aria-label="Heatmap legend">
              <Typography variant="caption" color="text.secondary">Rode once</Typography>
              <Box style={{ backgroundImage: `linear-gradient(90deg, ${(dark ? STOPS_DARK : STOPS).slice(2).map(([, c]) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`).join(', ')})` }} sx={{ width: 160, height: 10, borderRadius: 5 }} />
              <Typography variant="caption" color="text.secondary">Many times</Typography>
            </Box>
          )}
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            {!showRoutes
              ? 'Routes are hidden. Turn on "Show routes" to see them again.'
              : style === 'heat'
                ? 'The brighter a street, the more often you rode it. Rides over the same street add up.'
                : 'Click a route for details. Routes are simplified to keep the map fast.'}
          </Typography>
        </>
      )}

      {shops && (
        <Card sx={{ mt: 3 }}>
          <CardContent>
            <Typography variant="h6">Bike shops nearby</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {shops.list.length === 0
                ? `No bike shops found within ${shops.radiusKm} km of the blue dot. Zoom out or move the map and search again.`
                : `${shops.list.length} found within ${shops.radiusKm} km of the blue dot, nearest first. Drag the dot to search from another place. `}
              {shops.list.length > 0 && <>Amber pins are shops tagged as offering repairs.</>}
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
              {shops.list.map((sh) => (
                <Box key={sh.id} sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', py: 1.5, borderTop: '1px solid', borderColor: 'divider', flexWrap: 'wrap' }}>
                  <Box sx={{ flex: '1 1 240px', minWidth: 0 }}>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Link component="button" type="button" underline="hover" onClick={() => map?.flyTo([sh.lat, sh.lon], 16)} sx={{ fontWeight: 600, textAlign: 'left' }}>{sh.name}</Link>
                      {sh.repair && <Chip size="small" color="secondary" label="Repairs" />}
                      {sh.brand && <Chip size="small" variant="outlined" label={sh.brand} />}
                    </Box>
                    <Typography variant="body2" color="text.secondary">{sh.address || 'Address not listed'}</Typography>
                    {sh.openingHours && <Typography variant="caption" color="text.secondary">Hours: {sh.openingHours}</Typography>}
                  </Box>
                  <Typography variant="body2" fontWeight={600} sx={{ whiteSpace: 'nowrap' }}>{sh.distanceKm} km</Typography>
                  <Box sx={{ display: 'flex', gap: 1.5 }}>
                    <Link href={directionsUrl(sh)} target="_blank" rel="noopener noreferrer" variant="body2">Directions</Link>
                    {sh.website && <Link href={safeUrl(sh.website)} target="_blank" rel="noopener noreferrer" variant="body2">Website</Link>}
                    {sh.phone && <Link href={`tel:${sh.phone.replace(/[^+\d]/g, '')}`} variant="body2">Call</Link>}
                  </Box>
                </Box>
              ))}
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
              Data from OpenStreetMap, edited by volunteers, so details can be missing or out of date. Whether a shop is an authorized
              dealer or service center for a brand is not part of this data: check with the shop before you go.
            </Typography>
          </CardContent>
        </Card>
      )}
    </>
  );
}

const directionsUrl = (sh) => `https://www.openstreetmap.org/directions?route=%3B${sh.lat}%2C${sh.lon}`;
// Website tags are user-edited: only ever link to http(s)
const safeUrl = (u) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);

function ShopDetails({ shop }) {
  return (
    <div>
      <strong>{shop.name}</strong>
      {shop.repair && <div>Repairs</div>}
      <div>{shop.address || 'Address not listed'}</div>
      {shop.openingHours && <div>Hours: {shop.openingHours}</div>}
      <div>{shop.distanceKm} km away</div>
      <a href={directionsUrl(shop)} target="_blank" rel="noopener noreferrer">Directions</a>
      {shop.website && <> · <a href={safeUrl(shop.website)} target="_blank" rel="noopener noreferrer">Website</a></>}
    </div>
  );
}
