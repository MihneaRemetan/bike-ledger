import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { BIKE_TYPES, COMPONENT_TYPES, SERVICE_TYPES, label, toOptions } from '../lib/constants';
import { lowerFirst, todayStr } from '../lib/format';
import { useNotify } from './Notify';
import EntityFormDialog from './EntityFormDialog';

const bikeOptions = (bikes) => (bikes || []).map((b) => ({ value: String(b.id), label: b.name }));
const str = (v) => (v == null ? v : String(v));

export function BikeFormDialog({ open, bike, onClose, onSaved }) {
  const notify = useNotify();
  const fields = [
    { name: 'name', label: 'Name', type: 'text', required: true },
    { name: 'type', label: 'Type', type: 'select', required: true, options: toOptions(BIKE_TYPES) },
    { name: 'brand', label: 'Brand', type: 'text' },
    { name: 'model', label: 'Model', type: 'text' },
    { name: 'year', label: 'Year', type: 'number' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ];
  const initial = useMemo(() => bike || { type: 'GRAVEL' }, [bike]);
  return (
    <EntityFormDialog
      open={open}
      title={bike ? 'Edit bike' : 'Add bike'}
      fields={fields}
      initialValues={initial}
      onClose={onClose}
      onSubmit={async (v) => {
        const saved = bike
          ? await api(`/bikes/${bike.id}`, { method: 'PUT', body: v })
          : await api('/bikes', { method: 'POST', body: v });
        notify.success(bike ? 'Bike updated' : 'Bike added');
        onSaved(saved);
      }}
    />
  );
}

export function ComponentFormDialog({ open, component, bikes, defaultBikeId, onClose, onSaved }) {
  const notify = useNotify();
  const [defaults, setDefaults] = useState({});
  const touched = useRef(false);

  useEffect(() => {
    if (!open) return;
    touched.current = Boolean(component);
    api('/components/defaults').then(setDefaults).catch(() => {});
  }, [open, component]);

  const initial = useMemo(
    () =>
      component
        ? { ...component, bikeId: str(component.bikeId), retiredAt: component.retiredAt }
        : { bikeId: defaultBikeId ? String(defaultBikeId) : '', type: 'CHAIN', installedAt: todayStr(), initialKm: 0, maxKm: defaults.CHAIN ?? 4000 },
    [component, defaultBikeId, defaults]
  );

  const fields = [
    { name: 'bikeId', label: 'Bike', type: 'select', required: true, options: bikeOptions(bikes), disabled: Boolean(component), helperText: component ? 'To use it on another bike, use the Move button' : undefined },
    { name: 'type', label: 'Type', type: 'select', required: true, options: toOptions(COMPONENT_TYPES) },
    { name: 'brand', label: 'Brand', type: 'text' },
    { name: 'model', label: 'Model', type: 'text' },
    { name: 'installedAt', label: 'Installed on', type: 'date', required: true },
    { name: 'initialKm', label: 'Km before mounting', type: 'number', endAdornment: 'km', helperText: 'Use for second-hand or pre-used parts' },
    { name: 'maxKm', label: 'Wear limit', type: 'number', required: true, endAdornment: 'km', helperText: 'Suggested from the component type' },
    { name: 'price', label: 'Price (RON)', type: 'number' },
    { name: 'retiredAt', label: 'Retired on', type: 'date', visible: () => Boolean(component) },
  ];

  return (
    <EntityFormDialog
      open={open}
      title={component ? 'Edit component' : 'Add component'}
      fields={fields}
      initialValues={initial}
      onClose={onClose}
      onFieldChange={(name, value) => {
        if (name === 'maxKm') touched.current = true;
        if (name === 'type' && !touched.current && defaults[value]) return { maxKm: defaults[value] };
        return {};
      }}
      onSubmit={async (v) => {
        const saved = component
          ? await api(`/components/${component.id}`, { method: 'PUT', body: v })
          : await api('/components', { method: 'POST', body: v });
        notify.success(component ? 'Component updated' : 'Component added');
        onSaved(saved);
      }}
    />
  );
}

export function RideFormDialog({ open, ride, bikes, defaultBikeId, onClose, onSaved }) {
  const notify = useNotify();
  const initial = useMemo(
    () => (ride ? { ...ride, bikeId: str(ride.bikeId) } : { bikeId: defaultBikeId ? String(defaultBikeId) : '', date: new Date().toISOString() }),
    [ride, defaultBikeId]
  );
  const fields = [
    { name: 'bikeId', label: 'Bike', type: 'select', required: true, options: bikeOptions(bikes) },
    { name: 'date', label: 'Date and time', type: 'datetime', required: true },
    { name: 'title', label: 'Title', type: 'text' },
    { name: 'distanceKm', label: 'Distance', type: 'number', required: true, endAdornment: 'km' },
    { name: 'durationMin', label: 'Duration', type: 'number', endAdornment: 'min' },
    { name: 'elevationM', label: 'Elevation gain', type: 'number', endAdornment: 'm' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ];
  return (
    <EntityFormDialog
      open={open}
      title={ride ? 'Edit ride' : 'Add ride'}
      fields={fields}
      initialValues={initial}
      onClose={onClose}
      onSubmit={async (v) => {
        const saved = ride
          ? await api(`/rides/${ride.id}`, { method: 'PUT', body: v })
          : await api('/rides', { method: 'POST', body: v });
        notify.success(ride ? 'Ride updated' : 'Ride added');
        onSaved(saved);
      }}
    />
  );
}

export function ServiceFormDialog({ open, service, bikes, preset, onClose, onSaved }) {
  const notify = useNotify();
  const [components, setComponents] = useState([]);

  useEffect(() => {
    if (open) api('/components').then(setComponents).catch(() => setComponents([]));
  }, [open]);

  const initial = useMemo(
    () =>
      service
        ? { ...service, bikeId: str(service.bikeId), componentId: str(service.componentId) }
        : {
            bikeId: preset?.bikeId ? String(preset.bikeId) : '',
            componentId: preset?.componentId ? String(preset.componentId) : '',
            type: preset?.type || 'CLEAN',
            date: todayStr(),
          },
    [service, preset]
  );

  const componentOptions = (v) =>
    components
      .filter((c) => String(c.bikeId) === String(v.bikeId) && (!c.retiredAt || String(c.id) === String(v.componentId)))
      .map((c) => ({
        value: String(c.id),
        label: [label(COMPONENT_TYPES, c.type), [c.brand, c.model].filter(Boolean).join(' ')].filter(Boolean).join(' – ') + (c.retiredAt ? ' (retired)' : ''),
      }));

  const showNew = (v) => !service && v.type === 'REPLACE' && v.componentId;
  const mounting = (v) => showNew(v) && v.mountNew;

  const fields = [
    { name: 'bikeId', label: 'Bike', type: 'select', required: true, options: bikeOptions(bikes) },
    { name: 'type', label: 'Service type', type: 'select', required: true, options: toOptions(SERVICE_TYPES) },
    { name: 'componentId', label: 'Component', type: 'select', options: componentOptions, helperText: 'Optional. Required for replacements' },
    { name: 'date', label: 'Date', type: 'date', required: true },
    { name: 'cost', label: 'Cost (RON)', type: 'number' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
    { name: 'mountNew', label: 'Mount a new part', type: 'checkbox', visible: showNew },
    { name: 'newBrand', label: 'New part brand', type: 'text', visible: mounting },
    { name: 'newModel', label: 'New part model', type: 'text', visible: mounting },
    { name: 'newMaxKm', label: 'New part wear limit', type: 'number', endAdornment: 'km', helperText: 'Empty = same as the old part', visible: mounting },
    { name: 'newPrice', label: 'New part price (RON)', type: 'number', visible: mounting },
  ];

  return (
    <EntityFormDialog
      open={open}
      title={service ? 'Edit service' : 'Log service'}
      fields={fields}
      initialValues={initial}
      onClose={onClose}
      onFieldChange={(name) => (name === 'bikeId' ? { componentId: '', mountNew: false } : {})}
      onSubmit={async (v) => {
        const body = { bikeId: v.bikeId, componentId: v.componentId, date: v.date, type: v.type, cost: v.cost, notes: v.notes };
        if (mounting(v)) {
          body.replacement = { brand: v.newBrand, model: v.newModel, maxKm: v.newMaxKm, price: v.newPrice };
        }
        let saved;
        try {
          saved = service
            ? await api(`/services/${service.id}`, { method: 'PUT', body })
            : await api('/services', { method: 'POST', body });
        } catch (err) {
          const map = { 'replacement.brand': 'newBrand', 'replacement.model': 'newModel', 'replacement.maxKm': 'newMaxKm', 'replacement.price': 'newPrice' };
          err.details = (err.details || []).map((d) => ({ ...d, field: map[d.field] || d.field }));
          throw err;
        }
        if (saved.newComponent) {
          const name = label(COMPONENT_TYPES, saved.newComponent.type);
          notify.success(`${name} retired, new ${lowerFirst(name)} mounted`);
        } else if (saved.retiredComponentId) {
          const comp = components.find((c) => c.id === saved.retiredComponentId);
          notify.success(`${comp ? label(COMPONENT_TYPES, comp.type) : 'Component'} retired`);
        } else {
          notify.success(service ? 'Service updated' : 'Service logged');
        }
        onSaved(saved);
      }}
    />
  );
}

// Moves a part to another bike as of a date. Its km on the old bike are kept.
export function MoveComponentDialog({ open, component, bikes, onClose, onSaved }) {
  const notify = useNotify();
  const others = (bikes || []).filter((b) => !component || b.id !== component.bikeId);
  const initial = useMemo(() => ({ bikeId: '', date: todayStr() }), [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const fields = [
    { name: 'bikeId', label: 'Move to', type: 'select', required: true, options: bikeOptions(others) },
    { name: 'date', label: 'Moved on', type: 'date', required: true, helperText: 'Rides from this day count for the new bike' },
  ];
  return (
    <EntityFormDialog
      open={open}
      title="Move to another bike"
      submitLabel="Move"
      fields={fields}
      initialValues={initial}
      onClose={onClose}
      onSubmit={async (v) => {
        const saved = await api(`/components/${component.id}/move`, { method: 'POST', body: v });
        notify.success(`Moved to ${saved.bikeName}`);
        onSaved(saved);
      }}
    />
  );
}

// A maintenance rule: do something every N km and/or every N days
export function RuleFormDialog({ open, rule, bikeId, parts, onClose, onSaved }) {
  const notify = useNotify();
  const initial = useMemo(
    () => (rule ? { ...rule, componentId: str(rule.componentId) } : { serviceType: 'CLEAN', startDate: todayStr() }),
    [rule]
  );
  const partOptions = (parts || []).map((c) => ({ value: String(c.id), label: [label(COMPONENT_TYPES, c.type), [c.brand, c.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ') }));
  const fields = [
    { name: 'title', label: 'What needs doing', type: 'text', required: true, helperText: 'For example: Clean and lube the chain' },
    { name: 'serviceType', label: 'Counts as', type: 'select', required: true, options: toOptions(SERVICE_TYPES), helperText: 'Logging a service of this type restarts the counters' },
    { name: 'componentId', label: 'Only for this part', type: 'select', options: partOptions, helperText: 'Optional. Leave empty for a rule about the whole bike' },
    { name: 'everyKm', label: 'Every', type: 'number', endAdornment: 'km', helperText: 'Set a distance, a number of days, or both' },
    { name: 'everyDays', label: 'Or every', type: 'number', endAdornment: 'days' },
    { name: 'startDate', label: 'Counting from', type: 'date', helperText: 'Until a matching service is logged' },
  ];
  return (
    <EntityFormDialog
      open={open}
      title={rule ? 'Edit rule' : 'Add maintenance rule'}
      fields={fields}
      initialValues={initial}
      onClose={onClose}
      onSubmit={async (v) => {
        const saved = rule
          ? await api(`/maintenance/rules/${rule.id}`, { method: 'PUT', body: v })
          : await api('/maintenance/rules', { method: 'POST', body: { ...v, bikeId } });
        notify.success(rule ? 'Rule updated' : 'Rule added');
        onSaved(saved);
      }}
    />
  );
}
