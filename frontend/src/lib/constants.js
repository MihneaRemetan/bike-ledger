export const BIKE_TYPES = {
  ROAD: 'Road', MTB: 'Mountain', GRAVEL: 'Gravel', CITY: 'City', OTHER: 'Other',
};
export const COMPONENT_TYPES = {
  CHAIN: 'Chain', CASSETTE: 'Cassette', CHAINRING: 'Chainring', TYRE_FRONT: 'Front tyre',
  TYRE_REAR: 'Rear tyre', BRAKE_PADS: 'Brake pads', BRAKE_ROTORS: 'Brake rotors',
  CABLES: 'Cables', BAR_TAPE: 'Bar tape', OTHER: 'Other',
};
export const SERVICE_TYPES = {
  REPLACE: 'Replacement', CLEAN: 'Cleaning', ADJUST: 'Adjustment', REPAIR: 'Repair', INSPECTION: 'Inspection',
};
export const STATUS_LABELS = { OK: 'OK', WARN: 'Wearing out', REPLACE: 'Replace now', RETIRED: 'Retired' };
// Maintenance rules use their own words but the same colours as the wear statuses
export const RULE_STATUS_LABELS = { OK: 'OK', DUE: 'Due soon', OVERDUE: 'Overdue', PAUSED: 'Paused' };
export const RULE_STATUS_COLOR = { OK: 'OK', DUE: 'WARN', OVERDUE: 'REPLACE', PAUSED: 'RETIRED' };

export const toOptions = (map) => Object.entries(map).map(([value, label]) => ({ value, label }));
export const label = (map, key) => map[key] || key || '';
