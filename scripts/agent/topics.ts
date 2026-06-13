/**
 * Evergreen seed backlog across the 5 pillars. The planner picks the next
 * topic whose key is not yet in Notion. Keyword signals (keywords.ts) reorder
 * this list by rising interest; this file is the stable source of topics.
 */
import { canonicalKey } from './topic-key.ts';

export interface SeedTopic {
  key: string;
  title: string;          // working title; the model may refine
  brief: string;          // what the guide must cover
  imageEntity: string;    // optional Wikipedia/Wikimedia subject (inline use)
  coverQueries: string[]; // reliable, photogenic cover subjects (clean stock)
  tags: string[];
  searchHints: string[];  // seed phrases for keyword expansion
}

// Pillar 1 — India-outbound visa guides. `cover` = photogenic subjects that
// reliably yield clean, on-topic stock photos (skyline/landmark/flag) — NOT
// embassy buildings, which return dated documentary/officials photos.
const VISA_COUNTRIES: { name: string; cc: string; cover: string[] }[] = [
  { name: 'Japan', cc: 'japan', cover: ['Mount Fuji Japan', 'Tokyo city skyline', 'Japan flag'] },
  { name: 'Schengen (Europe)', cc: 'schengen', cover: ['Paris Eiffel Tower', 'Europe city travel', 'European passport'] },
  { name: 'United Kingdom', cc: 'uk', cover: ['London skyline Big Ben', 'United Kingdom flag', 'London travel'] },
  { name: 'United States', cc: 'us', cover: ['New York City skyline', 'American flag', 'USA travel'] },
  { name: 'Canada', cc: 'canada', cover: ['Toronto skyline', 'Canada flag', 'Canadian Rockies'] },
  { name: 'Australia', cc: 'australia', cover: ['Sydney Opera House', 'Australia flag', 'Australian outback'] },
  { name: 'Ireland', cc: 'ireland', cover: ['Dublin Ireland', 'Irish countryside cliffs', 'Ireland travel'] },
  { name: 'UAE', cc: 'uae', cover: ['Dubai skyline Burj Khalifa', 'UAE flag', 'Dubai travel'] },
  { name: 'Singapore', cc: 'singapore', cover: ['Singapore Marina Bay Sands', 'Singapore skyline', 'Singapore travel'] },
  { name: 'Thailand', cc: 'thailand', cover: ['Bangkok temple', 'Thailand beach', 'Thailand travel'] },
];

function visaTopics(): SeedTopic[] {
  return VISA_COUNTRIES.map((c) => ({
    key: canonicalKey(['visa', c.cc, 'in']),
    title: `How to Apply for a ${c.name} Visa from India`,
    brief:
      `A complete, current step-by-step guide for Indian passport holders applying for a ${c.name} visa: ` +
      `visa types, eligibility, document checklist, fees in INR, where to apply (VFS/embassy), appointment process, ` +
      `processing time, and common rejection reasons. Practical, accurate, no fluff.`,
    imageEntity: '',
    coverQueries: c.cover,
    tags: ['Visa', 'India', c.name, 'Guide'],
    searchHints: [`${c.name.toLowerCase()} visa from india`, `${c.name.toLowerCase()} visa for indians`],
  }));
}

// Pillars 3 & 4 — mobility/safety explainers and practical how-tos.
const STATIC_TOPICS: SeedTopic[] = [
  {
    key: canonicalKey(['mobility', 'middle-east', 'flights']),
    title: 'How the Middle East Situation Affects Your Flights and Travel Plans',
    brief:
      'A traveler-focused explainer (not war news): airspace closures and reroutes, why fares and flight times change, ' +
      'refund/rebooking rights, travel-insurance implications, and what to check before flying through the Gulf. Update as the situation changes.',
    imageEntity: '',
    coverQueries: ['airport departure board', 'airplane wing above clouds', 'airport terminal travelers'],
    tags: ['Mobility', 'Safety', 'Flight', 'Middle East'],
    searchHints: ['middle east flights affected', 'is it safe to fly middle east'],
  },
  {
    key: canonicalKey(['howto', 'esim', 'india-travel']),
    title: 'eSIM for International Travel from India: A Practical Guide',
    brief:
      'How eSIMs work, which phones support them, buying before vs after landing, top providers and rough costs, ' +
      'activation steps, and pitfalls. Aimed at Indian travelers going abroad.',
    imageEntity: '',
    coverQueries: ['smartphone traveler using phone', 'mobile phone world map travel', 'person using phone airport'],
    tags: ['How-to', 'eSIM', 'India', 'Guide'],
    searchHints: ['esim for international travel india', 'best esim for travel'],
  },
  {
    key: canonicalKey(['howto', 'forex', 'india-travel']),
    title: 'Forex, Cards, and UPI Abroad: How Indians Should Carry Money When Travelling',
    brief:
      'Forex cards vs debit/credit cards vs cash, where UPI works abroad, markups and fees to avoid, ' +
      'how much cash to carry, and a simple pre-trip money checklist for Indian travelers.',
    imageEntity: '',
    coverQueries: ['foreign currency banknotes', 'credit cards and cash wallet', 'currency exchange counter'],
    tags: ['How-to', 'Money', 'India', 'Guide'],
    searchHints: ['forex card vs credit card abroad', 'upi abroad countries'],
  },
  {
    key: canonicalKey(['howto', 'travel-insurance', 'india']),
    title: 'Travel Insurance for Indians: What to Buy and What to Skip',
    brief:
      'What travel insurance actually covers, when it is mandatory (Schengen etc.), medical vs trip-cancellation cover, ' +
      'how claims work, and how to choose a plan. Practical for Indian outbound travelers.',
    imageEntity: '',
    coverQueries: ['traveler with luggage at airport', 'passport boarding pass suitcase', 'airport terminal traveler'],
    tags: ['How-to', 'Insurance', 'India', 'Guide'],
    searchHints: ['travel insurance for indians', 'is travel insurance mandatory schengen'],
  },
];

export function seedTopics(): SeedTopic[] {
  return [...visaTopics(), ...STATIC_TOPICS];
}
