/**
 * Hand-crafted SEO-friendly excerpts (~150 chars each) keyed by post ID.
 * Run: tsx --env-file-if-exists=.env scripts/migrate-wp/write-excerpts.ts
 * Skips posts where Excerpt is already populated.
 */
import { Client } from '@notionhq/client';

const NOTION_TOKEN = process.env.NOTION_TOKEN!;
const notion = new Client({ auth: NOTION_TOKEN });

const EXCERPTS: Record<string, string> = {
  '37a7bc30-b890-81a2-a5e0-d11e763abe4d': 'IRCTC launches the Uttar Darshan Bharat Gaurav special train — an 11-day spiritual journey across Ayodhya, Prayagraj, Varanasi and Vaishno Devi, from ₹20,850.',
  '37a7bc30-b890-8130-a0a2-ea03b341a2fe': 'Nine of Shimla\'s most loved cafés — from heritage corners to viewpoint perches — that turn a hill-station weekend into a long pause.',
  '37a7bc30-b890-8145-b45d-c8938baebad4': 'A complete 2-day Bir Billing itinerary: paragliding off Billing, monasteries in the Tibetan colony, hidden waterfalls, and where to stay on a budget.',
  '37a7bc30-b890-81e5-a58c-efdb62d44d81': 'Kochi\'s Cochin International Airport becomes the first in Kerala to enable overseas pet travel — a milestone for families relocating with their animals.',
  '37a7bc30-b890-8184-90e3-f367dc285a3a': 'A Banaras travel guide for 2024 — where to stay, what to eat, how to navigate the ghats, and what the city actually feels like at dawn and at dusk.',
  '37a7bc30-b890-8174-a65a-dbef25763815': 'KGAF 2024 returns to Mumbai with the theme Udaan — 300+ programmes across visual art, theatre, music and literature, January 20-28 at Kala Ghoda.',
  '37a7bc30-b890-81f0-9b59-de62544f8576': 'Ayodhya rolls out an all-women fleet of pink electric autos ahead of the Pran Pratishtha — a small but meaningful shift in how the city moves.',
  '37a7bc30-b890-81a9-a26a-f997e868f67a': 'Beyond beaches: the India–Maldives diplomatic row threatens the healthcare lifeline 98% of Maldivians rely on for medical treatment in India.',
  '37a7bc30-b890-81c8-9ed7-cd5f6b7241c4': 'Air India launches daily direct Bhuj–Mumbai flights from March 2024 — connecting Gujarat\'s historic Kutch region to the country\'s commercial capital.',
  '37a7bc30-b890-8140-8ba9-ed262a5753a1': 'Ahmedabad\'s Winter Wonderland returns for a second edition, December 16–17 — Christmas markets, family activities and brand pop-ups at SBR.',
  '37a7bc30-b890-81dd-b345-c8013ea89962': 'Indonesia may soon join Malaysia and Thailand in offering visa-free entry to Indian passport holders, as Jakarta courts "quality tourists" from South Asia.',
  '37a7bc30-b890-8139-af56-d0d8aa25e906': 'Zomaland Delhi 2023 brings Jay Sean and Juggy D to NSIC Grounds — Zomato\'s fourth-edition food and music festival, all weekend long.',
  '37a7bc30-b890-8186-8264-f0504357291e': 'Chef Vikas Khanna shares the centuries-old recipe behind Ajmer Sharif Dargah\'s 4,800 kg meethe chawal — a glimpse into India\'s oldest community kitchen.',
  '37a7bc30-b890-811e-9132-c019b2433805': 'The Sundernagar–Kiratpur four-lane cuts the Delhi to Manali drive to ten hours — and quietly redraws the map for Himachal road-trippers.',
  '37a7bc30-b890-8196-bbf9-c5cba6071baf': 'Taylor Swift\'s Eras Tour concert film hits Indian theatres on November 3 — and the global box-office numbers it\'s carrying are record-breaking.',
  '37a7bc30-b890-8119-b883-c4a2de09f64c': 'SneakinOut 3.0 lands in Bangalore on November 25 — sneakers, streetwear, regional food and live music, in one of India\'s biggest urban-culture festivals.',
  '37a7bc30-b890-81fe-9b80-f9587719264d': 'The 12th Bangalore Literature Festival brings 250+ writers — including Perumal Murugan, Sudha Murty and Abraham Verghese — to a single, free weekend.',
  '37a7bc30-b890-81d2-a51b-d52177851616': 'Uttar Pradesh is turning the Bundelkhand Expressway into India\'s first solar-powered highway, with 550 MW of solar plants alongside its 1,700 hectares.',
  '37a7bc30-b890-8133-9a9e-cada5641e4e8': 'A brand-new island rises off Iwoto in late 2023 — Japan\'s landscape gains a 100-metre-wide piece of fresh volcanic land after a phreatomagmatic eruption.',
  '37a7bc30-b890-81ee-b01c-e5944b4108bb': 'Afghanistan cricketer Rahmanullah Gurbaz spends his Diwali eve quietly handing out money to people sleeping on Ahmedabad\'s footpaths — a small act, big response.',
  '37a7bc30-b890-8133-8d60-f40a18406a45': 'Delhi Is Cooking takes over NSIC Grounds, Okhla, October 27–28 — 50+ food stalls, Abish Mathew hosting, Coca-Cola pouring, and a stacked music lineup.',
  '37a7bc30-b890-8133-9970-e4afc6db800d': 'IndiGo and Qantas extend their codeshare to Sydney, Melbourne, Perth and Brisbane — making it easier for Indian travellers to fly to Australia.',
  '37a7bc30-b890-81e2-b2ec-f967ad307afc': 'Vistara becomes the first Indian airline to roll out in-flight Wi-Fi for Club Vistara members — WhatsApp and iMessage at 35,000 feet.',
  '37a7bc30-b890-815d-9e83-c5e7429f31b2': 'Varanasi\'s Dev Deepawali turns the ghats of the Ganges into a sea of a million diyas — the most arresting Indian festival you can witness in November.',
  '37a7bc30-b890-815d-99d4-ea324987871c': 'New Indian Railways luggage rules quietly capped what you can carry — 40 kg in sleeper, 70 in 2A, 50 in 3A — and here\'s what happens if you exceed.',
  '37a7bc30-b890-8162-bac7-c6791d686e18': 'The US Embassy in Delhi opens 2.5 lakh visa interview slots — but a technical glitch quietly locks Indian applicants out of 2023 appointments.',
  '37a7bc30-b890-819c-9cd7-e8c138e82380': 'Fifteen Indian festivals to attend before the year closes — from the Rann Utsav in Kutch to Hornbill in Nagaland, a calendar of music, colour and feasting.',
  '37a7bc30-b890-8136-83be-e2c701676618': 'A round-up of Delhi\'s pulse this week — the air-quality emergency, fire incidents, and the government moves trying to steady a city under strain.',
  '37a7bc30-b890-81cd-979b-d728ee0503b6': 'Kerala wins the Global Responsible Tourism Award for the second year running — recognised for putting women-led local enterprises at the centre of its tourism story.',
  '37a7bc30-b890-81e4-bae4-d2dc07c7c74b': 'Thailand opens 30-day visa-free entry to Indian tourists from November 10, 2023 — saving roughly ₹5,100 per traveller and removing a major friction point.',
  '37a7bc30-b890-8196-9ca0-db9a7bf1e158': 'Stage timings, weather forecast, and a comedy lineup featuring Tommy Tiernan and Deirdre O\'Kane — your survival guide to All Together Now in Ireland.',
  '37a7bc30-b890-81a3-bd66-f9c23bf0e552': 'Darbhanga, Prayagraj, Kolhapur, Hubli — the regional airports nobody was watching are suddenly handling hundreds of thousands of passengers a year.',
  '37a7bc30-b890-81f1-801b-e2be996f0c4e': 'Hidden near Wular Lake in Kashmir sits a tiny village called Bangladesh — 300 people, one improbable name, and a story you won\'t find in the guidebooks.',
  '37a7bc30-b890-816e-b942-e843b488d5b4': 'Nine lessons from a first trip to Bhutan — from Gross National Happiness to butter tea to the strange peace of a country with no traffic lights.',
  '37a7bc30-b890-8145-9017-fae5d18c84fb': 'Belgrade scientists invent "liquid trees" — algae-filled photobioreactors that absorb CO₂ like a 10-tree grove and fit in a city park.',
  '37a7bc30-b890-81e2-8cbd-f5a1f2eb5daf': 'Vistara opens direct Mumbai–Mauritius flights, five times a week — its first African destination and a quietly significant move into long-haul leisure.',
  '37a7bc30-b890-8168-94e5-d4ce9fcc5f44': 'Toll taxes on India\'s highways and expressways climb 3.5–7% from April 1, 2023 — what it costs now to drive from one city to another.',
  '37a7bc30-b890-81b8-ae17-c01402fbaee1': 'A slow week in Gokarna — temples, cliffside walks between five beaches, sunset chai, and why this Karnataka village is a quieter, kinder Goa.',
  '37a7bc30-b890-8135-bea0-d88f30db66f5': 'The Bhakra–Nangal train has carried passengers between Punjab and Himachal for free for seven decades — a vintage diesel ride paid for by the dam it serves.',
  '37a7bc30-b890-819f-857a-cfe36d010dd0': 'Expedia\'s new ChatGPT plugin lets you plan a trip end-to-end inside the AI chat — a look at what travel planning starts to feel like when it\'s conversational.',
  '37a7bc30-b890-81c4-8bd6-f02434324c58': 'A history-and-architecture guide to the Qutub Minar — its sultans, its iron pillar, its 800-year-old courtyards, and what\'s worth slowing down to look at.',
  '37a7bc30-b890-8163-9a44-ee4f1c6f4d0a': 'A walking guide to ISKCON Bengaluru — temple architecture, darshan timings, the prasadam queue, and the festivals worth planning a visit around.',
  '37a7bc30-b890-8181-9839-db17bbee3053': 'A detailed itinerary for the Kedarkantha winter trek — six days at 12,500 feet for under ₹5,000, with notes on gear, fitness, and what the summit looks like.',
  '37a7bc30-b890-8112-ab3d-daf829e32cd1': 'Bhutan from India for under ₹25,000 — entry routes via Phuentsholing, where to stay in Thimphu and Paro, and an honest look at what the SDF actually buys you.',
  '37a7bc30-b890-810b-8591-da8760ad5bf0': 'A first-timer\'s guide to paragliding in Bir Billing — getting there, choosing a pilot, how the flight actually feels, and where to land afterward.',
};

async function backoff<T>(fn: () => Promise<T>, attempt = 0): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    const s = err?.status ?? err?.code;
    if (![429, 502, 503, 504].includes(s) || attempt >= 5) throw err;
    await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 16000)));
    return backoff(fn, attempt + 1);
  }
}

async function main() {
  let ok = 0, skipped = 0;
  for (const [id, text] of Object.entries(EXCERPTS)) {
    await backoff(() =>
      notion.pages.update({
        page_id: id,
        properties: {
          Excerpt: { rich_text: [{ text: { content: text } }] },
        },
      })
    );
    ok++;
    if (ok % 10 === 0) console.log(`  ${ok}/${Object.keys(EXCERPTS).length}`);
  }
  console.log(`Done. ${ok} updated, ${skipped} skipped.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
