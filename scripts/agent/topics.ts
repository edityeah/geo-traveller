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
  { name: 'Germany', cc: 'germany', cover: ['Berlin Brandenburg Gate', 'Germany castle', 'Germany flag'] },
  { name: 'France', cc: 'france', cover: ['Paris Eiffel Tower', 'France lavender fields', 'France flag'] },
  { name: 'Italy', cc: 'italy', cover: ['Rome Colosseum', 'Venice canal', 'Italy flag'] },
  { name: 'Switzerland', cc: 'switzerland', cover: ['Swiss Alps mountains', 'Switzerland lake village', 'Switzerland flag'] },
  { name: 'Netherlands', cc: 'netherlands', cover: ['Amsterdam canal houses', 'Netherlands tulip fields', 'Netherlands flag'] },
  { name: 'Spain', cc: 'spain', cover: ['Barcelona Sagrada Familia', 'Spain plaza', 'Spain flag'] },
  { name: 'New Zealand', cc: 'new-zealand', cover: ['New Zealand mountains lake', 'New Zealand landscape', 'New Zealand flag'] },
  { name: 'South Korea', cc: 'south-korea', cover: ['Seoul city skyline', 'South Korea palace', 'South Korea flag'] },
  { name: 'Vietnam', cc: 'vietnam', cover: ['Ha Long Bay Vietnam', 'Vietnam rice terraces', 'Vietnam flag'] },
  { name: 'Indonesia (Bali)', cc: 'indonesia', cover: ['Bali rice terraces temple', 'Bali beach', 'Indonesia flag'] },
  { name: 'Malaysia', cc: 'malaysia', cover: ['Kuala Lumpur Petronas Towers', 'Malaysia islands', 'Malaysia flag'] },
  { name: 'Turkey', cc: 'turkey', cover: ['Istanbul mosque skyline', 'Cappadocia hot air balloons', 'Turkey flag'] },
  { name: 'Sri Lanka', cc: 'sri-lanka', cover: ['Sri Lanka tea plantation', 'Sigiriya rock Sri Lanka', 'Sri Lanka beach'] },
  { name: 'Saudi Arabia', cc: 'saudi-arabia', cover: ['Mecca Kaaba', 'Riyadh skyline', 'Saudi Arabia desert'] },
  { name: 'Egypt', cc: 'egypt', cover: ['Egypt pyramids Giza', 'Nile river Egypt', 'Egypt flag'] },
  { name: 'South Africa', cc: 'south-africa', cover: ['Cape Town Table Mountain', 'South Africa safari', 'South Africa flag'] },
  { name: 'Russia', cc: 'russia', cover: ['Moscow Saint Basil Cathedral', 'Russia landscape', 'Russia flag'] },
  { name: 'Azerbaijan', cc: 'azerbaijan', cover: ['Baku skyline Azerbaijan', 'Azerbaijan old city', 'Azerbaijan flag'] },
  { name: 'Georgia', cc: 'georgia', cover: ['Tbilisi Georgia old town', 'Georgia Caucasus mountains', 'Georgia flag'] },
  { name: 'Hong Kong', cc: 'hong-kong', cover: ['Hong Kong skyline harbour', 'Hong Kong street', 'Hong Kong'] },
  { name: 'Taiwan', cc: 'taiwan', cover: ['Taipei 101 skyline', 'Taiwan lantern festival', 'Taiwan flag'] },
  { name: 'Kenya', cc: 'kenya', cover: ['Kenya safari Maasai Mara', 'Kenya savanna elephants', 'Kenya flag'] },
  { name: 'Mauritius', cc: 'mauritius', cover: ['Mauritius beach turquoise', 'Mauritius island lagoon', 'Mauritius'] },
  { name: 'Maldives', cc: 'maldives', cover: ['Maldives overwater villa', 'Maldives turquoise lagoon', 'Maldives beach'] },
  { name: 'Brazil', cc: 'brazil', cover: ['Rio de Janeiro Christ Redeemer', 'Brazil beach', 'Brazil flag'] },
  { name: 'Qatar', cc: 'qatar', cover: ['Doha skyline Qatar', 'Qatar desert', 'Qatar flag'] },
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
  {
    key: canonicalKey(['howto', 'passport', 'apply-india']),
    title: 'How to Apply for an Indian Passport: Documents, Fees, and Timeline',
    brief:
      'Step-by-step: fresh passport application on Passport Seva, document checklist, fees, police verification, ' +
      'appointment booking, and how long it takes. Include the Tatkal (urgent) route.',
    imageEntity: '',
    coverQueries: ['Indian passport', 'passport application documents', 'passport on map'],
    tags: ['How-to', 'Passport', 'India', 'Guide'],
    searchHints: ['how to apply for indian passport', 'passport seva apply'],
  },
  {
    key: canonicalKey(['howto', 'passport', 'renew-india']),
    title: 'How to Renew Your Indian Passport (and Tatkal Fast-Track)',
    brief:
      'When and how to renew, re-issue vs renewal, documents needed, fees, and the Tatkal option for urgent renewal. ' +
      'Common reasons for delay and how to avoid them.',
    imageEntity: '',
    coverQueries: ['Indian passport renewal', 'passport and pen', 'passport documents desk'],
    tags: ['How-to', 'Passport', 'India', 'Guide'],
    searchHints: ['renew indian passport', 'passport renewal tatkal'],
  },
  {
    key: canonicalKey(['howto', 'international-driving-permit', 'india']),
    title: 'International Driving Permit from India: How to Get One and Where It Works',
    brief:
      'What an IDP is, which countries accept it, how to apply at your RTO, documents and fees, validity, ' +
      'and driving-abroad tips for Indians.',
    imageEntity: '',
    coverQueries: ['driving abroad road trip', 'car on scenic highway', 'driver license and keys'],
    tags: ['How-to', 'Driving', 'India', 'Guide'],
    searchHints: ['international driving permit india', 'idp from india how to apply'],
  },
  {
    key: canonicalKey(['howto', 'cheap-flights', 'india']),
    title: 'How to Find Cheap International Flights from India',
    brief:
      'Practical tactics: best booking windows, fare alerts, flexible dates, hub vs direct, error fares, ' +
      'and tools that actually help Indian travelers save on long-haul fares.',
    imageEntity: '',
    coverQueries: ['airplane window wing sunset', 'airport departure board', 'airplane flying sky'],
    tags: ['How-to', 'Flight', 'India', 'Guide'],
    searchHints: ['cheap international flights from india', 'best time to book flights'],
  },
  {
    key: canonicalKey(['howto', 'schengen-which-country', 'india']),
    title: 'Which Schengen Country Should You Apply Through? A Guide for Indians',
    brief:
      'How to choose the right Schengen consulate (main destination / first entry rule), appointment availability, ' +
      'approval-rate differences, and tips to avoid rejection. For Indian applicants.',
    imageEntity: '',
    coverQueries: ['Europe map travel', 'European city street', 'Schengen passport stamp'],
    tags: ['Visa', 'Schengen', 'India', 'Guide'],
    searchHints: ['which schengen country to apply', 'easiest schengen visa for indians'],
  },
  {
    key: canonicalKey(['guide', 'visa-free-countries', 'indians']),
    title: 'Visa-Free and Visa-on-Arrival Countries for Indian Passport Holders',
    brief:
      'An up-to-date list of countries Indians can visit visa-free or with visa-on-arrival / e-visa, grouped by region, ' +
      'with entry conditions and stay limits. Note that this needs periodic updating.',
    imageEntity: '',
    coverQueries: ['Indian passport and globe', 'world map travel pins', 'passport stamps'],
    tags: ['Visa', 'India', 'Guide'],
    searchHints: ['visa free countries for indians', 'visa on arrival for indian passport'],
  },
];

export function seedTopics(): SeedTopic[] {
  return [...visaTopics(), ...STATIC_TOPICS];
}
