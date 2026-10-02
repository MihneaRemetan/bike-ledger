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

module.exports = {
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
  listQuery,
  componentListQuery,
};
