/**
 * Script to find Viator destination IDs for POPULAR_DESTINATIONS
 *
 * Run with: node scripts/find-destination-ids.js
 */

import 'dotenv/config';

const VIATOR_API_BASE = 'https://api.sandbox.viator.com/partner';
const API_KEY = process.env.VIATOR_API_KEY;

// Destinations that need IDs
const DESTINATIONS_TO_FIND = [
  // Europe (missing IDs)
  'Prague', 'Vienna', 'Santorini', 'Munich', 'Berlin', 'Milan', 'Edinburgh',
  'Budapest', 'Copenhagen', 'Stockholm', 'Brussels', 'Nice', 'Amalfi Coast',
  'Cinque Terre', 'Dubrovnik',

  // United States (missing IDs)
  'Chicago', 'Boston', 'New Orleans', 'Washington DC', 'Seattle', 'Orlando',
  'San Diego', 'Nashville', 'Austin', 'Denver', 'Philadelphia', 'Phoenix',
  'Key West', 'Savannah', 'Charleston', 'Napa Valley', 'Portland', 'Sedona',
  'Grand Canyon',

  // Asia & Middle East (missing IDs)
  'Bangkok', 'Singapore', 'Hong Kong', 'Seoul', 'Bali', 'Kyoto', 'Osaka',
  'Taipei', 'Kuala Lumpur', 'Ho Chi Minh City', 'Phuket', 'Hanoi', 'Siem Reap',
  'Chiang Mai', 'Mumbai', 'Delhi', 'Jaipur', 'Beijing', 'Shanghai', 'Abu Dhabi',
  'Jerusalem', 'Tel Aviv', 'Maldives',

  // Other (Americas, Africa, Oceania) (missing IDs)
  'Cabo San Lucas', 'Reykjavik', 'Maui', 'Melbourne', 'Auckland', 'Queenstown',
  'Fiji', 'Cape Town', 'Marrakech', 'Cairo', 'Istanbul', 'Rio de Janeiro',
  'Buenos Aires', 'Lima', 'Cartagena', 'Puerto Vallarta', 'Playa del Carmen',
  'Jamaica', 'Aruba', 'Bahamas', 'Puerto Rico', 'Costa Rica', 'Panama City'
];

async function fetchAllDestinations() {
  console.log('Fetching all destinations from Viator API...\n');

  const response = await fetch(`${VIATOR_API_BASE}/destinations`, {
    method: 'GET',
    headers: {
      'exp-api-key': API_KEY,
      'Accept': 'application/json;version=2.0',
      'Accept-Language': 'en-US',
    },
  });

  if (!response.ok) {
    throw new Error(`Viator API error: ${response.status}`);
  }

  const data = await response.json();
  return data.destinations || [];
}

function findBestMatch(searchName, destinations) {
  const searchLower = searchName.toLowerCase();

  // Try exact name match first
  const exactMatch = destinations.find(d =>
    d.name?.toLowerCase() === searchLower
  );
  if (exactMatch) return { match: exactMatch, type: 'exact' };

  // Try starts with match
  const startsWithMatch = destinations.find(d =>
    d.name?.toLowerCase().startsWith(searchLower)
  );
  if (startsWithMatch) return { match: startsWithMatch, type: 'startsWith' };

  // Try contains match
  const containsMatches = destinations.filter(d =>
    d.name?.toLowerCase().includes(searchLower)
  );
  if (containsMatches.length === 1) {
    return { match: containsMatches[0], type: 'contains' };
  }
  if (containsMatches.length > 1) {
    // Return all for manual review
    return { matches: containsMatches, type: 'multiple' };
  }

  // Try partial word match (for things like "New York City" -> "New York")
  const words = searchLower.split(' ');
  if (words.length > 1) {
    const partialMatch = destinations.find(d => {
      const destLower = d.name?.toLowerCase() || '';
      return words.every(word => destLower.includes(word));
    });
    if (partialMatch) return { match: partialMatch, type: 'partial' };
  }

  return null;
}

async function main() {
  if (!API_KEY) {
    console.error('Error: VIATOR_API_KEY not set in environment');
    process.exit(1);
  }

  const allDestinations = await fetchAllDestinations();
  console.log(`Found ${allDestinations.length} total destinations in Viator API\n`);

  // Debug: show first few destinations to understand the data structure
  console.log('Sample destination structure:');
  console.log(JSON.stringify(allDestinations.slice(0, 3), null, 2));
  console.log('');
  console.log('='.repeat(80));
  console.log('DESTINATION ID LOOKUP RESULTS');
  console.log('='.repeat(80));

  const found = [];
  const notFound = [];
  const multipleMatches = [];

  for (const destName of DESTINATIONS_TO_FIND) {
    const result = findBestMatch(destName, allDestinations);

    if (!result) {
      notFound.push(destName);
    } else if (result.type === 'multiple') {
      multipleMatches.push({ name: destName, matches: result.matches });
    } else {
      found.push({
        searchName: destName,
        id: result.match.destinationId,
        viatorName: result.match.name,
        type: result.match.type,
        matchType: result.type
      });
    }
  }

  // Print found destinations in the format needed for the array
  console.log('\n✅ FOUND DESTINATIONS - Copy this into POPULAR_DESTINATIONS:\n');
  console.log('// EUROPE');
  const europeNames = ['Prague', 'Vienna', 'Santorini', 'Munich', 'Berlin', 'Milan', 'Edinburgh', 'Budapest', 'Copenhagen', 'Stockholm', 'Brussels', 'Nice', 'Amalfi Coast', 'Cinque Terre', 'Dubrovnik'];
  found.filter(f => europeNames.includes(f.searchName)).forEach(f => {
    console.log(`  { id: ${f.id}, name: '${f.searchName}' },  // ${f.viatorName} (${f.type})`);
  });

  console.log('\n// UNITED STATES');
  const usNames = ['Chicago', 'Boston', 'New Orleans', 'Washington DC', 'Seattle', 'Orlando', 'San Diego', 'Nashville', 'Austin', 'Denver', 'Philadelphia', 'Phoenix', 'Key West', 'Savannah', 'Charleston', 'Napa Valley', 'Portland', 'Sedona', 'Grand Canyon'];
  found.filter(f => usNames.includes(f.searchName)).forEach(f => {
    console.log(`  { id: ${f.id}, name: '${f.searchName}' },  // ${f.viatorName} (${f.type})`);
  });

  console.log('\n// ASIA & MIDDLE EAST');
  const asiaNames = ['Bangkok', 'Singapore', 'Hong Kong', 'Seoul', 'Bali', 'Kyoto', 'Osaka', 'Taipei', 'Kuala Lumpur', 'Ho Chi Minh City', 'Phuket', 'Hanoi', 'Siem Reap', 'Chiang Mai', 'Mumbai', 'Delhi', 'Jaipur', 'Beijing', 'Shanghai', 'Abu Dhabi', 'Jerusalem', 'Tel Aviv', 'Maldives'];
  found.filter(f => asiaNames.includes(f.searchName)).forEach(f => {
    console.log(`  { id: ${f.id}, name: '${f.searchName}' },  // ${f.viatorName} (${f.type})`);
  });

  console.log('\n// OTHER (Americas, Africa, Oceania)');
  const otherNames = ['Cabo San Lucas', 'Reykjavik', 'Maui', 'Melbourne', 'Auckland', 'Queenstown', 'Fiji', 'Cape Town', 'Marrakech', 'Cairo', 'Istanbul', 'Rio de Janeiro', 'Buenos Aires', 'Lima', 'Cartagena', 'Puerto Vallarta', 'Playa del Carmen', 'Jamaica', 'Aruba', 'Bahamas', 'Puerto Rico', 'Costa Rica', 'Panama City'];
  found.filter(f => otherNames.includes(f.searchName)).forEach(f => {
    console.log(`  { id: ${f.id}, name: '${f.searchName}' },  // ${f.viatorName} (${f.type})`);
  });

  // Print destinations with multiple matches (need manual selection)
  if (multipleMatches.length > 0) {
    console.log('\n\n⚠️  MULTIPLE MATCHES - Choose the correct one:\n');
    for (const item of multipleMatches) {
      console.log(`"${item.name}" has ${item.matches.length} possible matches:`);
      item.matches.slice(0, 5).forEach(m => {
        console.log(`    { id: ${m.destinationId}, name: '${item.name}' },  // ${m.name} (${m.type})`);
      });
      console.log('');
    }
  }

  // Print not found
  if (notFound.length > 0) {
    console.log('\n\n❌ NOT FOUND - These may need different search terms:\n');
    notFound.forEach(name => console.log(`  - ${name}`));
  }

  console.log('\n' + '='.repeat(80));
  console.log(`Summary: ${found.length} found, ${multipleMatches.length} need selection, ${notFound.length} not found`);
}

main().catch(console.error);
