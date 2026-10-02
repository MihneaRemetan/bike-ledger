import { BIKE_TYPES, COMPONENT_TYPES, label } from './constants';

// What to type into a shop's search box to find a replacement for this part
export function partSearchTerms(component, bikeType) {
  const kind = label(COMPONENT_TYPES, component.type).toLowerCase();
  const named = [component.brand, component.model].filter(Boolean).join(' ');
  // a known brand and model is the best search; otherwise the kind of part plus the kind of bike
  return named ? `${named} ${kind}` : [kind, bikeType ? `${label(BIKE_TYPES, bikeType).toLowerCase()} bike` : 'bicycle'].join(' ');
}

const SHOPS = [
  { name: 'Google Shopping', url: (q) => `https://www.google.com/search?tbm=shop&q=${q}` },
  { name: 'Amazon', url: (q) => `https://www.amazon.de/s?k=${q}` },
  { name: 'eBay', url: (q) => `https://www.ebay.com/sch/i.html?_nkw=${q}` },
  { name: 'eMAG', url: (q) => `https://www.emag.ro/search/${q}` },
];

// Search links only: nothing is sent to these shops until the user opens one
export function buyLinks(component, bikeType) {
  const terms = partSearchTerms(component, bikeType);
  const q = encodeURIComponent(terms);
  return { terms, links: SHOPS.map((s) => ({ name: s.name, url: s.url(q) })) };
}
