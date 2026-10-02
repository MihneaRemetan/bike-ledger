const { z } = require('zod');

const BIKE_TYPES = ['ROAD', 'MTB', 'GRAVEL', 'CITY', 'OTHER'];
const COMPONENT_TYPES = [
  'CHAIN', 'CASSETTE', 'CHAINRING', 'TYRE_FRONT', 'TYRE_REAR',
  'BRAKE_PADS', 'BRAKE_ROTORS', 'CABLES', 'BAR_TAPE', 'OTHER',
];
const SERVICE_TYPES = ['REPLACE', 'CLEAN', 'ADJUST', 'REPAIR', 'INSPECTION'];

// Forms send "" for empty fields and numbers as strings.
const emptyToNull = (v) => (v === '' ? null : v);

const optText = (max) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() || null : v),
    z.string().max(max, `Max ${max} characters`).nullable().optional()
  );

const toNumber = (v) => {
  if (v === '' || v === null) return null;
  if (typeof v === 'string') return Number(v);
  return v;
};
const reqNumber = (v) => (v === '' || v === null ? undefined : typeof v === 'string' ? Number(v) : v);

const optNum = (schema) => z.preprocess(toNumber, schema.nullable().optional());
const reqNum = (schema) => z.preprocess(reqNumber, schema);

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use format YYYY-MM-DD');
const reqDate = z.preprocess(emptyToNull, dateOnly);
const optDate = z.preprocess(emptyToNull, dateOnly.nullable().optional());

const id = reqNum(z.number({ invalid_type_error: 'Must be a number' }).int().positive());
const optId = optNum(z.number().int().positive());

const register = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  email: z.string().trim().toLowerCase().email('Invalid email').max(255),
  password: z.string().min(8, 'At least 8 characters').max(128),
});

const login = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email'),
  password: z.string().min(1, 'Password is required'),
});

const bikeBase = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  type: z.enum(BIKE_TYPES, { errorMap: () => ({ message: 'Invalid bike type' }) }),
  brand: optText(120),
  model: optText(120),
  year: optNum(z.number().int('Must be a whole number').min(1900).max(2100)),
  notes: optText(1000),
});

const componentBase = z.object({
  bikeId: id,
  type: z.enum(COMPONENT_TYPES, { errorMap: () => ({ message: 'Invalid component type' }) }),
  brand: optText(120),
  model: optText(120),
  installedAt: reqDate,
  initialKm: z.preprocess(
    (v) => (v === '' || v === null ? undefined : typeof v === 'string' ? Number(v) : v),
    z.number({ invalid_type_error: 'Must be a number' }).min(0).max(200000).default(0)
  ),
  maxKm: optNum(z.number().positive('Must be greater than 0').max(200000)),
  price: optNum(z.number().min(0).max(100000)),
  retiredAt: optDate,
});

const retiredCheck = (d, ctx) => {
  if (d.retiredAt && d.installedAt && d.retiredAt < d.installedAt) {
    ctx.addIssue({
      code: 'custom',
      path: ['retiredAt'],
      message: 'Retired date cannot be before installed date',
    });
  }
};

const rideBase = z.object({
  bikeId: id,
  date: z.preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    z.coerce.date({ errorMap: () => ({ message: 'Invalid date' }) })
  ),
  title: optText(120),
  distanceKm: reqNum(z.number({ invalid_type_error: 'Must be a number' }).positive('Must be greater than 0').max(2000, 'Max 2000 km')),
  durationMin: optNum(z.number().int().min(0).max(2880)),
  elevationM: optNum(z.number().int().min(0).max(20000)),
  notes: optText(1000),
});

const replacement = z.object({
  brand: optText(120),
  model: optText(120),
  maxKm: optNum(z.number().positive().max(200000)),
  price: optNum(z.number().min(0).max(100000)),
});

const serviceBase = z.object({
  bikeId: id,
  componentId: optId,
  date: reqDate,
  type: z.enum(SERVICE_TYPES, { errorMap: () => ({ message: 'Invalid service type' }) }),
  cost: optNum(z.number().min(0).max(100000)),
  notes: optText(1000),
});

const ruleBase = z.object({
  bikeId: id,
  componentId: optId,
  title: z.string().trim().min(1, 'Title is required').max(120),
  serviceType: z.enum(SERVICE_TYPES, { errorMap: () => ({ message: 'Invalid service type' }) }),
  everyKm: optNum(z.number().positive('Must be greater than 0').max(200000)),
  everyDays: optNum(z.number().int('Must be a whole number').positive('Must be greater than 0').max(3650)),
  startDate: optDate,
});
const needsInterval = (d, ctx) => {
  if (d.everyKm == null && d.everyDays == null) {
    ctx.addIssue({ code: 'custom', path: ['everyKm'], message: 'Set a distance, a number of days, or both' });
  }
};
const ruleComplete = z.object({ date: optDate, cost: optNum(z.number().min(0).max(100000)), notes: optText(1000) });

const componentMove = z.object({ bikeId: id, date: reqDate });

const listQuery = z.object({
  bikeId: optId,
  from: optDate,
  to: optDate,
  limit: z.preprocess(
    (v) => (v === undefined || v === '' ? undefined : Number(v)),
    z.number().int().min(1).max(500).default(200)
  ),
});

const componentListQuery = listQuery
  .pick({ bikeId: true, limit: true })
  .extend({ status: z.enum(['active', 'retired']).optional() });

// Shape of a BikeLedger export file (see routes/data.js). Rows keep their old ids so references can be re-linked.
const exportId = z.number().int().positive();
const MAX = { bikes: 200, components: 5000, rides: 100000, services: 50000, rules: 5000, tracks: 100000 };
const bikeFile = bikeBase.extend({ id: exportId });
const mountFile = z.object({ bikeId: exportId, fromDate: dateOnly, toDate: dateOnly.nullable().optional() });
const componentFile = componentBase.extend({ id: exportId, bikeId: exportId, mounts: z.array(mountFile).max(100).optional() }).superRefine(retiredCheck);
const rideFile = rideBase.extend({ id: exportId, bikeId: exportId, source: z.enum(['MANUAL', 'GPX']).default('MANUAL') });
const serviceFile = serviceBase.extend({ id: exportId.optional(), bikeId: exportId, componentId: exportId.nullable().optional() });
const ruleFile = ruleBase.extend({ id: exportId.optional(), bikeId: exportId, componentId: exportId.nullable().optional() }).superRefine(needsInterval);
const trackFile = z.object({ rideId: exportId, points: z.array(z.tuple([z.number(), z.number()])).min(2).max(5000) });
const exportFile = z.object({
  app: z.literal('BikeLedger', { errorMap: () => ({ message: 'This is not a BikeLedger export' }) }),
  version: z.literal(1, { errorMap: () => ({ message: 'Unsupported export version' }) }),
  bikes: z.array(bikeFile).max(MAX.bikes),
  components: z.array(componentFile).max(MAX.components).default([]),
  rides: z.array(rideFile).max(MAX.rides).default([]),
  services: z.array(serviceFile).max(MAX.services).default([]),
  rules: z.array(ruleFile).max(MAX.rules).default([]),
  tracks: z.array(trackFile).max(MAX.tracks).default([]),
});

const yearQuery = z.object({
  year: z.preprocess((v) => (v === undefined || v === '' ? undefined : Number(v)), z.number().int().min(2000).max(2100).optional()),
});

module.exports = {
  exportFile,
  yearQuery,
  BIKE_TYPES,
  COMPONENT_TYPES,
  SERVICE_TYPES,
  register,
  login,
  bike: bikeBase,
  bikeUpdate: bikeBase.partial(),
  component: componentBase.superRefine(retiredCheck),
  componentUpdate: componentBase.partial(),
  ride: rideBase,
  rideUpdate: rideBase.partial(),
  service: serviceBase.extend({ replacement: replacement.optional() }),
  serviceUpdate: serviceBase.partial(),
  componentMove,
  maintenanceRule: ruleBase.superRefine(needsInterval),
  maintenanceRuleUpdate: ruleBase.partial(),
  maintenanceComplete: ruleComplete,
  maintenanceSuggest: z.object({ bikeId: id }),
  listQuery,
  componentListQuery,
};
