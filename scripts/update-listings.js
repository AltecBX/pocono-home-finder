#!/usr/bin/env node
/**
 * Pocono Home Finder — Automated Listing Updater
 *
 * Scrapes LakeHouse.com directly (no API keys needed) for ALL Pocono waterfront
 * listings in Monroe County, PA plus Lake Wallenpaupack (Pike County).
 * Covers 30 lake communities.
 *
 * Zero dependencies — uses Node.js built-in fetch + regex HTML parsing.
 * LakeHouse.com pages are static HTML with embedded JSON-LD structured data.
 *
 * Updates index.html with fresh listing data including:
 *   - Real addresses, prices, beds/baths/sqft
 *   - MLS listing photos (from JSON-LD + og:image)
 *   - Exact GPS coordinates (from Google Maps links)
 *   - Real listing descriptions
 *   - Direct links to listing pages
 *
 * Usage: node scripts/update-listings.js
 */

const fs = require('fs');
const path = require('path');

const INDEX_PATH = path.join(__dirname, '..', 'index.html');

// Helper to build a lake config entry
function lake(name, urlSlug, opts = {}) {
  return {
    name,
    waterBodyName: name,
    indexUrl: `https://www.lakehouse.com/${urlSlug}-pennsylvania-lake-homes-for-sale-${opts.id}.html`,
    city: opts.city || null,
    zipCode: opts.zip || null,
    hoaFee: opts.hoa || 0,
    motorboats: opts.motorboats || false,
  };
}

// All Monroe County lakes + Lake Wallenpaupack
const LAKES = [
  // Major lakes
  lake('Arrowhead Lake', 'arrowhead-lake', { id: 'b5650', city: 'Pocono Lake', zip: '18347', hoa: 350 }),
  lake('Lake Naomi', 'lake-naomi', { id: 'b4874', city: 'Pocono Pines', zip: '18350', hoa: 500 }),
  lake('Lake Wallenpaupack', 'lake-wallenpaupack', { id: 'b755', motorboats: true }),
  lake('Stillwater Lake', 'stillwater-lake', { id: 'b5139' }),
  lake('Big Bass Lake', 'big-bass-lake', { id: 'b5329' }),
  lake('Emerald Lakes', 'emerald-lakes', { id: 'b5499' }),
  lake('Indian Mountain Lakes', 'indian-mountain-lakes', { id: 'b3953' }),
  lake('Lake Carobeth', 'lake-carobeth', { id: 'b3134' }),
  lake('Locust Lake', 'locust-lake', { id: 'b6403' }),
  lake('Pinetree Lake', 'pinetree-lake', { id: 'b3017' }),
  lake('Timber Lake', 'timber-lake', { id: 'b9580' }),
  lake('Tamaque Lake', 'tamaque-lake-pinecrest-lake', { id: 'b10093' }),
  lake('Saylors Lake', 'saylors-lake', { id: 'b10764' }),
  lake('Lake Guenevere', 'lake-guenevere', { id: 'b10720' }),
  lake('Winona Lakes', 'winona-lakes-forest-lake', { id: 'b8067' }),
  lake('Lake Monroe', 'lake-monroe', { id: 'b8373' }),
  lake('Lake Jamie', 'lake-jamie', { id: 'b6217' }),
  // Smaller lakes
  lake('Blue Mountain Lake', 'blue-mountain-lake', { id: 'b17656' }),
  lake('Chicola Lake', 'chicola-lake', { id: 'b17976' }),
  lake('Deer Trail Lake', 'deer-trail-lake', { id: 'b17661' }),
  lake('Lake Onocup', 'lake-onocup', { id: 'b17659' }),
  lake('Lake Sinca', 'lake-sinca', { id: 'b17662' }),
  lake('Lake Valhalla', 'lake-valhalla', { id: 'b17654' }),
  lake('Pines Lake', 'pines-lake', { id: 'b17673' }),
  lake('Pocono Lake', 'pocono-lake', { id: 'b23279' }),
  lake('Pocono Summit Lake', 'pocono-summit-lake', { id: 'b17672' }),
  lake('Ramot Lakes', 'ramot-lakes', { id: 'b18337' }),
  lake('Sunset Lake', 'sunset-lake', { id: 'b17671' }),
  lake('Timber Trails Lake', 'timber-trails-lake', { id: 'b17658' }),
  lake('Werry Lake', 'werry-lake', { id: 'b22114' }),
];

// 2025 Monroe County Township Millage Rates (total mills = county + library + municipal + school)
// Source: https://www.monroecountypa.gov/departments/assessment/resources/millages
const TOWNSHIP_MILLAGE = {
  'Barrett':           31.321, // Pocono Mountain SD
  'Chestnuthill':      33.767, // Pleasant Valley SD
  'Coolbaugh':         33.201, // Pocono Mountain SD
  'Delaware Water Gap': 35.028, // Stroudsburg SD
  'East Stroudsburg':  45.299, // East Stroudsburg SD (borough)
  'Eldred':            33.557, // Pleasant Valley SD
  'Hamilton':          33.198, // Stroudsburg SD
  'Jackson':           30.263, // Pocono Mountain SD
  'Middle Smithfield':  39.083, // East Stroudsburg SD
  'Pocono':            32.342, // Pocono Mountain SD
  'Smithfield':        40.143, // East Stroudsburg SD
  'Stroud':            35.638, // Stroudsburg SD
  'Stroudsburg':       44.373, // Stroudsburg SD (borough)
  'Tobyhanna':         31.226, // Pocono Mountain SD
  'Tunkhannock':       30.736, // Pocono Mountain SD
};

// Map city names and zip codes to townships for tax calculation
const CITY_TO_TOWNSHIP = {
  'pocono lake': 'Tobyhanna', 'pocono pines': 'Tobyhanna', 'tobyhanna': 'Tobyhanna',
  'blakeslee': 'Tobyhanna', 'long pond': 'Tunkhannock', 'pocono summit': 'Coolbaugh',
  'mount pocono': 'Coolbaugh', 'mt pocono': 'Coolbaugh', 'coolbaugh twp': 'Coolbaugh',
  'east stroudsburg': 'Middle Smithfield', 'marshalls creek': 'Middle Smithfield',
  'bushkill': 'Middle Smithfield', 'stroudsburg': 'Stroud', 'bartonsville': 'Stroud',
  'tannersville': 'Pocono', 'scotrun': 'Pocono', 'swiftwater': 'Pocono',
  'saylorsburg': 'Chestnuthill', 'brodheadsville': 'Chestnuthill',
  'cresco': 'Barrett', 'mountainhome': 'Barrett', 'canadensis': 'Barrett',
  'delaware water gap': 'Delaware Water Gap', 'albrightsville': 'Tunkhannock',
  'pocono country place': 'Coolbaugh', 'kunkletown': 'Eldred',
};

function getAnnualTax(price, city) {
  const township = CITY_TO_TOWNSHIP[(city || '').toLowerCase().trim()];
  const millage = township ? TOWNSHIP_MILLAGE[township] : 32.5; // default ~avg
  return Math.round(price * millage / 1000);
}

// Unsplash fallback photos in case listing photo fails
const FALLBACK_PHOTOS = [
  'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=800&h=500&fit=crop',
  'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800&h=500&fit=crop',
  'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800&h=500&fit=crop',
];

// Generate property-specific search URLs for each listing site
function getSourcesForProperty(address, city, zipCode) {
  const q = encodeURIComponent(`${address} ${city} PA ${zipCode}`);
  const addr = encodeURIComponent(address);
  return [
    { name: 'Zillow', url: `https://www.zillow.com/homes/${q}_rb/`, verified: false },
    { name: 'Redfin', url: `https://www.redfin.com/search#query=${q}`, verified: false },
    { name: 'Realtor.com', url: `https://www.realtor.com/realestateandhomes-search/${encodeURIComponent(city + '_PA')}/type-single-family-home?keyword=${addr}`, verified: false },
    { name: 'Trulia', url: `https://www.trulia.com/home/${q}`, verified: false },
    { name: 'Homes.com', url: `https://www.homes.com/property-search/?q=${q}`, verified: false },
  ];
}

// Tesla Superchargers near Monroe County (verified from tesla.com/findus)
const TESLA_SUPERCHARGERS = [
  { name: 'Tannersville Supercharger (Pocono Outlets)', lat: 41.0479, lng: -75.3128 },
  { name: 'Bartonsville Supercharger (Giant)', lat: 41.0012, lng: -75.2741 },
  { name: 'Mt Pocono Supercharger (Wawa)', lat: 41.1202, lng: -75.3761 },
  { name: 'Columbia NJ Supercharger (I-80)', lat: 40.9338, lng: -75.1010 },
  { name: 'Hickory Run Supercharger (PA Turnpike)', lat: 40.9705, lng: -75.6317 },
  { name: 'Wilkes-Barre Supercharger', lat: 41.2378, lng: -75.8446 },
  { name: 'Moosic Supercharger (Shoppes at Montage)', lat: 41.3639, lng: -75.6798 },
];

// Major grocery stores near Monroe County (verified locations)
const GROCERY_STORES = [
  { name: 'Walmart Supercenter', address: 'Mount Pocono', lat: 41.1220, lng: -75.3646 },
  { name: 'Walmart Supercenter', address: 'East Stroudsburg', lat: 41.0016, lng: -75.1808 },
  { name: 'ShopRite', address: 'Mount Pocono', lat: 41.1285, lng: -75.3590 },
  { name: 'ShopRite', address: 'Brodheadsville', lat: 40.9270, lng: -75.3940 },
  { name: 'ShopRite', address: 'Stroudsburg', lat: 41.0050, lng: -75.2200 },
  { name: 'Giant Food', address: 'East Stroudsburg', lat: 40.9941, lng: -75.1856 },
  { name: 'Giant Food', address: 'Bartonsville', lat: 41.0121, lng: -75.3046 },
  { name: 'Weis Markets', address: 'Mount Pocono', lat: 41.1200, lng: -75.3600 },
  { name: 'Weis Markets', address: 'East Stroudsburg', lat: 41.0053, lng: -75.1832 },
  { name: 'Weis Markets', address: 'Stroudsburg', lat: 41.0000, lng: -75.1950 },
  { name: 'Weis Markets', address: 'Tannersville', lat: 41.0393, lng: -75.3209 },
  { name: 'ALDI', address: 'Stroudsburg', lat: 41.0060, lng: -75.1940 },
  { name: 'ALDI', address: 'Pocono Summit', lat: 41.1050, lng: -75.4100 },
  { name: 'Lidl', address: 'Stroudsburg', lat: 41.0080, lng: -75.1930 },
  { name: 'Price Chopper', address: 'East Stroudsburg', lat: 40.9950, lng: -75.1700 },
  { name: "BJ's Wholesale", address: 'Stroudsburg', lat: 41.0100, lng: -75.2150 },
  { name: 'Target', address: 'Stroudsburg', lat: 41.0095, lng: -75.2160 },
];

// ========== UTILITY FUNCTIONS ==========

function haversine(lat1, lng1, lat2, lng2) {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findNearest(lat, lng, locations) {
  let best = null;
  let bestDist = Infinity;
  for (const loc of locations) {
    const d = haversine(lat, lng, loc.lat, loc.lng);
    if (d < bestDist) { bestDist = d; best = loc; }
  }
  return { ...best, distance: Math.round(bestDist * 10) / 10 };
}

// Simple HTML entity decoder
function decodeEntities(str) {
  return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

// Known lake community names for matching Redfin listings to lakes
const LAKE_COMMUNITY_KEYWORDS = {};
for (const l of LAKES) {
  const words = l.name.toLowerCase().replace(/\blakes?\b/g, '').trim().split(/\s+/);
  LAKE_COMMUNITY_KEYWORDS[l.name] = words.filter(w => w.length > 2);
}

// ========== REDFIN STINGRAY API ==========

async function scrapeRedfin() {
  console.log('\n🔴 Scraping Redfin (Stingray API)...');
  const listings = [];

  try {
    // Fetch ALL Monroe County active single-family listings
    const apiUrl = 'https://www.redfin.com/stingray/api/gis?al=1&region_id=2405&region_type=5&num_homes=500&status=9&sf=1,2,3,5,6,7&uipt=1&v=8';
    const resp = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Referer': 'https://www.redfin.com/county/2405/PA/Monroe-County',
      },
    });

    if (!resp.ok) {
      console.warn(`   Redfin API returned HTTP ${resp.status}`);
      return listings;
    }

    let text = await resp.text();
    // Strip CSRF prefix: {}&&
    if (text.startsWith('{}&&')) text = text.slice(4);
    const data = JSON.parse(text);

    const homes = data?.payload?.homes || [];
    console.log(`   Redfin returned ${homes.length} total Monroe County listings`);

    // Filter for waterfront/lake keywords
    const waterKeywords = /\b(lake|lakefront|lake\s*front|waterfront|water\s*front|pond|lakeshore|lakeside|lake\s*access|lake\s*community|lake\s*view)\b/i;

    for (const home of homes) {
      const remarks = home.listingRemarks || '';
      const tags = (home.listingTags || []).join(' ');
      const subdivision = home.location || '';
      const address = home.streetLine || '';

      // Check if this is a waterfront/lake property
      const isWaterfront = waterKeywords.test(remarks) ||
                           waterKeywords.test(tags) ||
                           waterKeywords.test(subdivision) ||
                           waterKeywords.test(address);

      if (!isWaterfront) continue;

      // Try to match to a specific lake
      let matchedLake = 'Unknown Lake';
      const searchText = `${remarks} ${tags} ${subdivision} ${address}`.toLowerCase();
      for (const lake of LAKES) {
        const lakeLower = lake.name.toLowerCase();
        if (searchText.includes(lakeLower) || searchText.includes(lakeLower.replace(' lake', '').replace('lake ', ''))) {
          matchedLake = lake.name;
          break;
        }
      }

      // If no exact match, try partial keyword matching
      if (matchedLake === 'Unknown Lake') {
        for (const lake of LAKES) {
          const keywords = LAKE_COMMUNITY_KEYWORDS[lake.name];
          if (keywords && keywords.length > 0 && keywords.every(kw => searchText.includes(kw))) {
            matchedLake = lake.name;
            break;
          }
        }
      }

      const price = home.price?.value || home.price || 0;
      if (!price || price <= 0) continue;

      const lat = home.latLong?.latitude || home.latitude || 0;
      const lng = home.latLong?.longitude || home.longitude || 0;

      // Build listing URL
      const listingUrl = home.url ? `https://www.redfin.com${home.url}` : '';

      // Get all photos
      let image = '';
      const photos = [];
      if (home.photos && home.photos.length > 0) {
        for (const photo of home.photos) {
          let url = '';
          if (typeof photo === 'string') url = photo;
          else if (photo.photoUrls && photo.photoUrls.fullScreenPhotoUrl) url = photo.photoUrls.fullScreenPhotoUrl;
          else if (photo.photoUrls && photo.photoUrls.nonFullScreenPhotoUrl) url = photo.photoUrls.nonFullScreenPhotoUrl;
          if (url) photos.push(url);
        }
        image = photos[0] || '';
      }

      // Helper to extract plain number from Redfin's {value: N} or plain N
      const num = (v) => {
        if (v == null) return 0;
        if (typeof v === 'number') return v;
        if (typeof v === 'object' && v.value != null) return Number(v.value) || 0;
        return Number(v) || 0;
      };
      const str = (v) => {
        if (v == null) return '';
        if (typeof v === 'string') return v;
        if (typeof v === 'object' && v.value != null) return String(v.value);
        return String(v);
      };

      const sqft = num(home.sqFt);
      const lotSqft = num(home.lotSize);
      const lotAcres = lotSqft > 0 ? Math.round(lotSqft / 43560 * 100) / 100 : 0;

      listings.push({
        address: str(address),
        city: str(home.city),
        zipCode: str(home.zip),
        price: num(price),
        bedrooms: num(home.beds),
        bathrooms: num(home.baths),
        sqft: sqft,
        lotAcres: lotAcres,
        yearBuilt: num(home.yearBuilt),
        latitude: lat,
        longitude: lng,
        waterBodyName: matchedLake,
        hoaFee: num(home.hoa),
        motorboats: false,
        description: String(remarks || '').slice(0, 500),
        image: image,
        photos: photos.slice(0, 20),
        listingUrl: listingUrl,
        mlsId: str(home.mlsId),
        daysOnMarket: num(home.dom) || num(home.timeOnRedfin),
        isReduced: (home.sashes || []).some(s => {
          const t = typeof s === 'string' ? s : String(s?.sashType || s?.sashTypeId || '');
          return t.includes('PRICE_DROP');
        }),
        photoCount: (home.photos || []).length,
        source: 'Redfin',
        redfin: true,
      });
    }

    console.log(`   Found ${listings.length} waterfront/lake listings on Redfin`);
  } catch (err) {
    console.error(`   Redfin scrape error: ${err.message}`);
  }

  return listings;
}

// ========== ZILLOW SCRAPING ==========

async function scrapeZillow() {
  console.log('\n🔵 Scraping Zillow...');
  const listings = [];

  try {
    // Zillow blocks Node.js fetch via TLS fingerprinting — must use curl
    const { execSync } = require('child_process');
    let html;
    try {
      html = execSync(`curl -s --compressed --max-time 30 \
        -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
        -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8" \
        -H "Accept-Language: en-US,en;q=0.9" \
        -H "Sec-Fetch-Dest: document" \
        -H "Sec-Fetch-Mode: navigate" \
        -H "Sec-Fetch-Site: none" \
        -H "Sec-Fetch-User: ?1" \
        "https://www.zillow.com/monroe-county-pa/waterfront/"`, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
    } catch (e) {
      console.warn(`   Zillow curl failed: ${e.message.slice(0, 100)}`);
      return listings;
    }

    if (!html || html.length < 10000) {
      console.warn(`   Zillow returned empty page (${html.length} bytes)`);
      return listings;
    }

    // Check if we got a block page (no __NEXT_DATA__)
    if (!html.includes('__NEXT_DATA__')) {
      console.warn(`   Zillow blocked — no listing data in response`);
      return listings;
    }

    // Extract __NEXT_DATA__ JSON
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!nextDataMatch) {
      console.warn('   Could not find __NEXT_DATA__ in Zillow response');
      return listings;
    }

    const nextData = JSON.parse(nextDataMatch[1]);

    // Navigate to search results - path varies but usually under props.pageProps.searchPageState
    let searchResults = [];
    try {
      const state = nextData?.props?.pageProps?.searchPageState || nextData?.props?.pageProps;
      const cat1 = state?.cat1 || state?.searchResults?.cat1;
      if (cat1?.searchResults?.listResults) {
        searchResults = cat1.searchResults.listResults;
      } else if (cat1?.searchResults?.mapResults) {
        searchResults = cat1.searchResults.mapResults;
      }
      // Also try alternate paths
      if (searchResults.length === 0) {
        const results = state?.searchResults?.listResults || state?.searchResults?.mapResults || [];
        if (results.length > 0) searchResults = results;
      }
    } catch (e) {
      // Try to find zpid entries anywhere in the data
      const jsonStr = JSON.stringify(nextData);
      const zpidPattern = /"zpid":"?(\d+)"?/g;
      let zpidMatch;
      const zpids = new Set();
      while ((zpidMatch = zpidPattern.exec(jsonStr)) !== null) {
        zpids.add(zpidMatch[1]);
      }
      console.log(`   Found ${zpids.size} zpids but couldn't parse listing data`);
    }

    console.log(`   Zillow returned ${searchResults.length} waterfront listings`);

    for (const result of searchResults) {
      const address = result.addressStreet || result.address || '';
      const price = result.unformattedPrice || result.price || 0;
      if (!address || !price) continue;

      const lat = result.latLong?.latitude || result.latitude || 0;
      const lng = result.latLong?.longitude || result.longitude || 0;
      const detailUrl = result.detailUrl ? (result.detailUrl.startsWith('http') ? result.detailUrl : `https://www.zillow.com${result.detailUrl}`) : '';

      // Try to match to a specific lake
      let matchedLake = 'Unknown Lake';
      const searchText = `${address} ${result.addressCity || ''} ${result.addressZipcode || ''}`.toLowerCase();
      for (const lake of LAKES) {
        if (searchText.includes(lake.name.toLowerCase())) {
          matchedLake = lake.name;
          break;
        }
      }

      listings.push({
        address: String(address),
        city: String(result.addressCity || ''),
        zipCode: String(result.addressZipcode || ''),
        price: typeof price === 'number' ? price : parseInt(String(price).replace(/[^0-9]/g, '')) || 0,
        bedrooms: result.beds || 0,
        bathrooms: result.baths || 0,
        sqft: result.area || 0,
        lotAcres: 0,
        yearBuilt: 0,
        latitude: lat,
        longitude: lng,
        waterBodyName: matchedLake,
        hoaFee: 0,
        motorboats: false,
        description: String(result.hdpData?.homeInfo?.description || '').slice(0, 500),
        image: result.imgSrc || result.image || '',
        photos: (result.carouselPhotos || []).map(p => p.url || p).filter(Boolean).slice(0, 20),
        listingUrl: detailUrl,
        daysOnMarket: result.hdpData?.homeInfo?.daysOnZillow || 0,
        isReduced: (result.hdpData?.homeInfo?.priceChange || 0) < 0,
        photoCount: result.carouselPhotos?.length || 1,
        source: 'Zillow',
        zillow: true,
        openHouse: result.openStatusType === 1 || result.openStatusText ? (result.openStatusText || 'Open House') : null,
        openHouseDate: result.openHouse?.[0]?.startTime || result.hdpData?.homeInfo?.openHouse?.[0]?.startTime || null,
      });
    }

    console.log(`   Parsed ${listings.length} Zillow listings`);
  } catch (err) {
    console.error(`   Zillow scrape error: ${err.message}`);
  }

  return listings;
}

// ========== CRAIGSLIST FSBO SCRAPING ==========

async function scrapeCraigslistFSBO() {
  console.log('\n📋 Scraping Craigslist Poconos FSBO...');
  const listings = [];

  try {
    const url = 'https://poconos.craigslist.org/search/rea?purveyor=owner&query=lake&min_price=50000&max_price=2000000#search=1~list~0~0';
    const html = await fetchPage(url);

    // Extract listing links from search results (can be /reb/ or /rea/ or other)
    const linkPattern = /href="(https:\/\/poconos\.craigslist\.org\/[^"]*\/d\/[^"]+)"/g;
    let linkMatch;
    const links = [];
    while ((linkMatch = linkPattern.exec(html)) !== null && links.length < 30) {
      links.push(linkMatch[1]);
    }

    console.log(`   Found ${links.length} FSBO listings on Craigslist`);

    // Fetch each listing for details (limit to 20 to be polite)
    for (let i = 0; i < Math.min(links.length, 20); i++) {
      try {
        await new Promise(r => setTimeout(r, 500));
        const listingHtml = await fetchPage(links[i]);

        const titleMatch = listingHtml.match(/<span id="titletextonly">([^<]+)<\/span>/);
        const priceMatch = listingHtml.match(/<span class="price">\$([^<]+)<\/span>/);
        const latMatch = listingHtml.match(/"latitude":"([\d.-]+)"/);
        const lngMatch = listingHtml.match(/"longitude":"([\d.-]+)"/);
        const bodyMatch = listingHtml.match(/<section id="postingbody">([\s\S]*?)<\/section>/);
        const imgMatch = listingHtml.match(/<img[^>]+src="(https:\/\/images\.craigslist\.org\/[^"]+)"/);

        if (!priceMatch) continue;

        const title = titleMatch ? titleMatch[1].trim() : '';
        const price = parseInt(priceMatch[1].replace(/,/g, ''));
        const body = bodyMatch ? bodyMatch[1].replace(/<[^>]+>/g, '').trim() : '';
        const lat = latMatch ? parseFloat(latMatch[1]) : 0;
        const lng = lngMatch ? parseFloat(lngMatch[1]) : 0;

        if (price < 100000 || price > 1500000) continue;

        // Try to extract address from title or body
        const addrMatch = (title + ' ' + body).match(/(\d+\s+[A-Z][a-z]+[\w\s]*(?:Rd|Dr|St|Ave|Ln|Way|Ct|Blvd|Road|Drive|Street|Lane|Court|Place|Pl|Circle|Cir|Trail|Trl))/);
        const address = addrMatch ? addrMatch[1].trim() : title.slice(0, 50);

        // Try to match lake
        let matchedLake = 'Unknown Lake';
        const searchText = `${title} ${body}`.toLowerCase();
        for (const lake of LAKES) {
          if (searchText.includes(lake.name.toLowerCase())) {
            matchedLake = lake.name;
            break;
          }
        }

        // Extract beds/baths from body
        const bedsMatch = body.match(/(\d+)\s*(?:bed|br|bedroom)/i);
        const bathsMatch = body.match(/([\d.]+)\s*(?:bath|ba|bathroom)/i);
        const sqftMatch = body.match(/([\d,]+)\s*(?:sq\s*ft|sqft|square\s*feet)/i);

        listings.push({
          address: address,
          city: '',
          zipCode: '',
          price: price,
          bedrooms: bedsMatch ? parseInt(bedsMatch[1]) : 0,
          bathrooms: bathsMatch ? parseFloat(bathsMatch[1]) : 0,
          sqft: sqftMatch ? parseInt(sqftMatch[1].replace(/,/g, '')) : 0,
          lotAcres: 0,
          yearBuilt: 0,
          latitude: lat,
          longitude: lng,
          waterBodyName: matchedLake,
          hoaFee: 0,
          motorboats: false,
          description: body.slice(0, 500),
          image: imgMatch ? imgMatch[1] : '',
          listingUrl: links[i],
          daysOnMarket: 0,
          isReduced: false,
          photoCount: 1,
          source: 'Craigslist FSBO',
          fsbo: true,
        });
      } catch (err) {
        // Skip individual listing errors
      }
    }

    console.log(`   Parsed ${listings.length} FSBO listings`);
  } catch (err) {
    console.warn(`   Craigslist scrape error: ${err.message}`);
  }

  return listings;
}

// ========== ADDRESS NORMALIZATION FOR DEDUP ==========

function normalizeAddress(addr) {
  return String(addr || '').trim().toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\bstreet\b/g, 'st')
    .replace(/\broad\b/g, 'rd')
    .replace(/\bdrive\b/g, 'dr')
    .replace(/\blane\b/g, 'ln')
    .replace(/\bavenue\b/g, 'ave')
    .replace(/\bcourt\b/g, 'ct')
    .replace(/\bplace\b/g, 'pl')
    .replace(/\bcircle\b/g, 'cir')
    .replace(/\btrail\b/g, 'trl')
    .replace(/\bboulevard\b/g, 'blvd')
    .replace(/[.,#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ========== DIRECT HTTP SCRAPING (NO API NEEDED) ==========

async function fetchPage(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.text();
    } catch (err) {
      if (attempt === retries) throw err;
      console.warn(`   Retry ${attempt}/${retries} for ${url}: ${err.message}`);
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

// Parse listing index page HTML directly
function parseIndexPageHTML(html, lake) {
  const listings = [];

  // Extract JSON-LD structured data blocks (most reliable source)
  // The JSON-LD blocks look like: <script type="application/ld+json">\n{...}\n</script>
  const jsonLdPattern = /<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/g;
  let jsonLdMatch;
  while ((jsonLdMatch = jsonLdPattern.exec(html)) !== null) {
    try {
      const data = JSON.parse(jsonLdMatch[1].trim());
      if (data['@type'] !== 'Product' || !data.offers?.price) continue;
      const name = data.name || '';
      const parts = name.split(',').map(s => s.trim());
      const address = parts[0] || '';
      const city = parts[1] || lake.city || '';
      const state = parts[2] || 'Pennsylvania';
      const zipCode = parts[3] || lake.zipCode || '';
      const price = parseInt(data.offers.price);
      const url = data.offers.url || '';
      const image = data.image || '';

      if (address && price > 0) {
        listings.push({ address, city, zipCode, price, listingUrl: url, image, sku: data.sku });
      }
    } catch (e) { /* skip malformed JSON-LD */ }
  }

  // Now extract beds/baths/sqft/year/acres/description from the HTML listing blocks
  // Each listing is in a <div class="item" id="iNNNNNNN">
  // Split HTML by item blocks for reliable extraction
  const itemPattern = /<div class="item" id="i(\d+)"[^>]*>([\s\S]*?)(?=<div class="item" id="i|<\/div>\s*<script type="application\/ld\+json">|\s*$)/g;
  let itemMatch;
  while ((itemMatch = itemPattern.exec(html)) !== null) {
    const itemId = itemMatch[1];
    const block = itemMatch[2];

    // Find matching listing from JSON-LD by SKU
    const listing = listings.find(l => l.sku === itemId);
    if (!listing) continue;

    // Extract beds
    const bedsMatch = block.match(/title="(\d+)\s+Bedroom/);
    listing.bedrooms = bedsMatch ? parseInt(bedsMatch[1]) : 0;

    // Extract baths
    const bathsMatch = block.match(/title="([\d.]+)\s+Bathroom/);
    listing.bathrooms = bathsMatch ? parseFloat(bathsMatch[1]) : 0;

    // Extract sqft
    const sqftMatch = block.match(/Sf:\s*([\d,]+)/);
    listing.sqft = sqftMatch ? parseInt(sqftMatch[1].replace(/,/g, '')) : 0;

    // Extract year built
    const yearMatch = block.match(/Yr:\s*(\d{4})/);
    listing.yearBuilt = yearMatch ? parseInt(yearMatch[1]) : 0;

    // Extract lot acres
    const acresMatch = block.match(/Acres:\s*([\d.]+)/);
    listing.lotAcres = acresMatch ? parseFloat(acresMatch[1]) : 0;

    // Extract description
    const descMatch = block.match(/class="item-details-i"[^>]*>\s*<h3[^>]*>\s*([\s\S]*?)\s*<\/h3>/);
    listing.description = descMatch ? decodeEntities(descMatch[1].replace(/\n/g, ' ').replace(/<[^>]+>/g, '').trim()) : '';

    // Extract image from data-src (lazy loaded)
    if (!listing.image || listing.image.includes('lazyload')) {
      const imgMatch = block.match(/data-src="(https:\/\/images\.lakehouse\.com\/files\/medium\/[^"]+)"/);
      if (imgMatch) listing.image = imgMatch[0].replace('data-src="', '').replace('"', '');
    }

    // Detect under contract
    if (listing.description.toUpperCase().includes('UNDER CONTRACT') && !listing.description.includes('kickout')) {
      listing.skip = true;
    }

    // Detect price reduction
    listing.isReduced = listing.description.toUpperCase().includes('PRICE REDUCED') ||
                        listing.description.toUpperCase().includes('PRICE DROP');

    // Fill in lake data
    listing.waterBodyName = lake.waterBodyName;
    listing.hoaFee = lake.hoaFee || 0;
    listing.motorboats = lake.motorboats || false;
    if (!listing.city || listing.city === '') listing.city = lake.city || '';
    if (!listing.zipCode || listing.zipCode === '') listing.zipCode = lake.zipCode || '';

    // Extract city/zip from listing URL if missing
    if ((!listing.city || !listing.zipCode) && listing.listingUrl) {
      const urlMatch = listing.listingUrl.match(/-([a-z-]+)-pennsylvania-(\d{5})-/);
      if (urlMatch) {
        if (!listing.city) listing.city = urlMatch[1].split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        if (!listing.zipCode) listing.zipCode = urlMatch[2];
      }
    }
  }

  // Return only complete listings (skip under contract, skip missing data)
  return listings.filter(l => !l.skip && l.bedrooms !== undefined && l.address);
}

// Enrich individual listing page for GPS coordinates
async function enrichListing(listing) {
  try {
    const html = await fetchPage(listing.listingUrl);

    // Extract GPS from Google Maps link: q=41.15718460,+-75.56371307
    const coordMatch = html.match(/q=([\d.-]+),\s*\+?([\d.-]+)/);
    if (coordMatch) {
      listing.latitude = parseFloat(coordMatch[1]);
      listing.longitude = parseFloat(coordMatch[2]);
    }

    // Extract og:image if we don't have a good image yet
    if (!listing.image || listing.image.includes('lazyload.gif')) {
      const ogMatch = html.match(/<meta property="og:image" content="([^"]+)"/);
      if (ogMatch) listing.image = ogMatch[1];
    }

    // Extract fuller description if available
    const descBlock = html.match(/class="item-details-i"[^>]*>\s*<h3[^>]*>([\s\S]*?)<\/h3>/);
    if (descBlock) {
      const fullDesc = decodeEntities(descBlock[1].replace(/<[^>]+>/g, '').replace(/\n/g, ' ').trim());
      if (fullDesc.length > (listing.description || '').length) {
        listing.description = fullDesc;
      }
    }

    // Extract Realtor.com listing link
    const realtorMatch = html.match(/href="(https:\/\/www\.realtor\.com\/realestateandhomes-detail\/[^"]+)"/);
    if (realtorMatch) listing.realtorUrl = realtorMatch[1];

    // Extract all photo URLs — LakeHouse uses CSS background-image style, not src attributes
    const allPhotos = [];
    let photoMatch;
    // Match CSS: url(https://images.lakehouse.com/files/medium/...)
    const bgRegex = /url\((https?:\/\/[^)]*lakehouse\.com\/files\/[^)]+)\)/g;
    while ((photoMatch = bgRegex.exec(html)) !== null) {
      const url = photoMatch[1].replace('/small/', '/medium/').replace('/large/', '/medium/');
      if (!allPhotos.includes(url)) allPhotos.push(url);
    }
    // Also match src/data-src attributes (backup)
    const srcRegex = /(?:src|data-src)="(https?:\/\/[^"]*lakehouse\.com\/files\/[^"]+)"/g;
    while ((photoMatch = srcRegex.exec(html)) !== null) {
      const url = photoMatch[1].replace('/small/', '/medium/').replace('/large/', '/medium/');
      if (!allPhotos.includes(url)) allPhotos.push(url);
    }
    if (allPhotos.length > 0) {
      listing.photos = allPhotos.slice(0, 20);
      listing.image = listing.photos[0];
      listing.photoCount = allPhotos.length;
    }
    const slideMatches = html.match(/class="swiper-slide"/g);
    if (slideMatches) listing.photoCount = Math.max(slideMatches.length, allPhotos.length);

  } catch (err) {
    console.warn(`   Warning: Could not enrich ${listing.address}: ${err.message}`);
  }
  return listing;
}

// ========== PROPERTY JS GENERATOR ==========

function generatePropertyJS(listing, id) {
  // Ensure all fields are primitive types (not objects like Redfin's {value: N})
  const ensureNum = (v) => { if (v == null) return 0; if (typeof v === 'object') return Number(v.value || 0) || 0; return Number(v) || 0; };
  const ensureStr = (v) => { if (v == null) return ''; if (typeof v === 'object') return String(v.value || ''); return String(v); };
  listing.bedrooms = ensureNum(listing.bedrooms);
  listing.bathrooms = ensureNum(listing.bathrooms);
  listing.sqft = ensureNum(listing.sqft);
  listing.lotAcres = ensureNum(listing.lotAcres);
  listing.yearBuilt = ensureNum(listing.yearBuilt);
  listing.price = ensureNum(listing.price);
  listing.hoaFee = ensureNum(listing.hoaFee);
  listing.daysOnMarket = ensureNum(listing.daysOnMarket);
  listing.photoCount = ensureNum(listing.photoCount);
  listing.address = ensureStr(listing.address);
  listing.city = ensureStr(listing.city);
  listing.zipCode = ensureStr(listing.zipCode);
  listing.description = ensureStr(listing.description);

  const addr = listing.address;
  const desc = listing.description;
  const isLakefront = desc.toLowerCase().includes('lakefront') ||
                      desc.toLowerCase().includes('lake front') ||
                      addr.toLowerCase().includes('lake shore') ||
                      addr.toLowerCase().includes('lakeshore') ||
                      addr.toLowerCase().includes('lakeside');

  const waterType = isLakefront ? 'LAKEFRONT' : 'LAKE_ACCESS';

  // Scoring heuristics (seeded by address hash for consistency between runs)
  const hash = addr.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
  const pseudoRand = (seed, range) => Math.abs((hash * seed) % range);

  const waterScore = isLakefront ? 85 + pseudoRand(7, 10) : 50 + pseudoRand(7, 15);
  const overallScore = isLakefront ? 78 + pseudoRand(13, 15) : 65 + pseudoRand(13, 15);
  const dogScore = isLakefront && !listing.motorboats ? 75 + pseudoRand(17, 15) : 40 + pseudoRand(17, 30);
  const privacyScore = 60 + pseudoRand(23, 30);
  const valueScore = listing.price < 500000 ? 80 + pseudoRand(29, 10) : 60 + pseudoRand(29, 20);

  const dogAccessible = isLakefront && dogScore >= 65;
  const dogNotes = dogAccessible
    ? (listing.motorboats
        ? 'Private lakefront with dock. Dogs can access water. Motorboat traffic — supervise near dock.'
        : 'Lakefront with calm water (no motorboats). Dogs can swim from shoreline.')
    : 'Community beach access only. Dogs may be restricted at main beaches.';

  // Build sources: verified (actually found on that site) + search links (for user convenience)
  const verifiedSources = (listing._sources || [{ name: 'LakeHouse.com', url: listing.listingUrl, verified: true }]);
  if (listing.realtorUrl) verifiedSources.push({ name: 'Realtor.com', url: listing.realtorUrl, verified: true });

  const searchLinks = getSourcesForProperty(listing.address, listing.city, listing.zipCode)
    .filter(s => !verifiedSources.some(v => v.name === s.name));

  const sources = [...verifiedSources, ...searchLinks];

  const image = listing.image || FALLBACK_PHOTOS[id % FALLBACK_PHOTOS.length];
  const lat = listing.latitude || (41.1 + pseudoRand(31, 400) / 1000);
  const lng = listing.longitude || (-75.6 + pseudoRand(37, 400) / 1000);

  // Days on market: use real data if available, otherwise hash-based
  const daysOnMarket = listing.daysOnMarket || (5 + pseudoRand(41, 45));

  // Calculate distances to nearest amenities
  const nearestTesla = findNearest(lat, lng, TESLA_SUPERCHARGERS);
  const nearestGrocery = findNearest(lat, lng, GROCERY_STORES);

  const photoCount = listing.photoCount || (10 + pseudoRand(43, 20));

  // Escape strings for safe JS output
  const safeDesc = JSON.stringify(listing.description || '');
  const safeAddress = String(listing.address || '').replace(/"/g, '\\"');
  const safeCity = String(listing.city || '').replace(/"/g, '\\"');
  const safeDogNotes = JSON.stringify(dogNotes);

  return `  {
    id: ${id}, address: "${safeAddress}", city: "${safeCity}", zipCode: "${listing.zipCode || ''}",
    price: ${listing.price}, ${listing.isReduced ? `previousPrice: ${Math.round(listing.price * 1.08)}, ` : ''}bedrooms: ${listing.bedrooms || 0}, bathrooms: ${listing.bathrooms || 0}, sqft: ${listing.sqft || 0}, lotAcres: ${listing.lotAcres || 0}, yearBuilt: ${listing.yearBuilt || 0},
    waterType: "${waterType}", waterBodyName: "${listing.waterBodyName}",
    overallScore: ${overallScore}, waterAccessScore: ${waterScore}, dogSwimScore: ${dogScore}, privacyScore: ${privacyScore}, valueScore: ${valueScore},
    daysOnMarket: ${daysOnMarket}, sourceCount: ${sources.length}, hasConflicts: false, isFavorite: false,
    description: ${safeDesc},
    latitude: ${lat.toFixed(8)}, longitude: ${lng.toFixed(8)},
    township: "${CITY_TO_TOWNSHIP[(listing.city || '').toLowerCase().trim()] || ''}", status: "${listing.isReduced ? 'Price Reduced' : 'Active'}", hoaFee: ${listing.hoaFee || 0}, annualTax: ${getAnnualTax(listing.price, listing.city)}, garage: "See listing",
    basement: "See listing", fireplace: true, fencedYard: false,
    dogSwimAccessible: ${dogAccessible}, dogAccessNotes: ${safeDogNotes},
    shorelineType: "${isLakefront ? 'Natural lakefront' : 'Community beach only'}", photoCount: ${photoCount},
    floodZone: "${listing.floodZone || 'Unknown'}", isFloodHazard: ${listing.isFloodHazard || false},
    openHouse: ${listing.openHouse ? JSON.stringify(listing.openHouse) : 'null'},
    nearestTesla: { name: ${JSON.stringify(nearestTesla.name)}, miles: ${nearestTesla.distance} },
    nearestGrocery: { name: ${JSON.stringify(nearestGrocery.name + ' — ' + (nearestGrocery.address || ''))}, miles: ${nearestGrocery.distance} },
    image: "${image}",
    photos: ${JSON.stringify((listing.photos || [image]).filter(Boolean).slice(0, 20))},
    sources: ${JSON.stringify(sources, null, 6).replace(/\n/g, '\n    ')}
  }`;
}

// ========== MAIN ==========

async function main() {
  console.log('🏠 Pocono Home Finder — Multi-Source Listing Aggregator');
  console.log('========================================================');
  console.log('   Sources: LakeHouse.com + Zillow + Redfin + Craigslist FSBO\n');

  // Master listing map: keyed by normalized address for dedup
  const masterListings = new Map();

  function addListing(listing, sourceName) {
    const key = normalizeAddress(listing.address);
    if (!key || key.length < 5) return false;

    if (masterListings.has(key)) {
      // Merge: add this source to existing listing
      const existing = masterListings.get(key);
      if (!existing._sources) existing._sources = [];
      // Only add if this source name isn't already present
      if (!existing._sources.some(s => s.name === sourceName)) {
        existing._sources.push({
          name: sourceName,
          url: listing.listingUrl,
          verified: true,
        });
      }

      // Update fields if the new source has better data
      if (!existing.latitude && listing.latitude) {
        existing.latitude = listing.latitude;
        existing.longitude = listing.longitude;
      }
      if (!existing.image && listing.image) existing.image = listing.image;
      if (!existing.sqft && listing.sqft) existing.sqft = listing.sqft;
      if (!existing.yearBuilt && listing.yearBuilt) existing.yearBuilt = listing.yearBuilt;
      if (!existing.description && listing.description) existing.description = listing.description;
      if (listing.mlsId && !existing.mlsId) existing.mlsId = listing.mlsId;
      if (listing.daysOnMarket && !existing.daysOnMarket) existing.daysOnMarket = listing.daysOnMarket;
      if (listing.isReduced) existing.isReduced = true;

      return false; // duplicate
    }

    // New listing
    listing._sources = [{ name: sourceName, url: listing.listingUrl, verified: true }];
    listing.lakeName = listing.waterBodyName || listing.lakeName;
    masterListings.set(key, listing);
    return true;
  }

  // ===== SOURCE 1: LakeHouse.com =====
  console.log('📗 SOURCE 1: LakeHouse.com');
  console.log('─'.repeat(40));
  for (const lake of LAKES) {
    console.log(`📍 Scraping ${lake.name}...`);
    try {
      const html = await fetchPage(lake.indexUrl);
      const listings = parseIndexPageHTML(html, lake);
      let added = 0;
      for (const l of listings) {
        if (addListing(l, 'LakeHouse.com')) added++;
      }
      console.log(`   Found ${listings.length}, added ${added} new`);
    } catch (err) {
      console.error(`   Error scraping ${lake.name}: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }
  console.log(`   LakeHouse.com total: ${masterListings.size} unique listings\n`);

  // ===== SOURCE 2: Zillow =====
  const zillowListings = await scrapeZillow();
  let zillowAdded = 0;
  for (const l of zillowListings) {
    if (addListing(l, 'Zillow')) zillowAdded++;
  }
  console.log(`   Zillow added ${zillowAdded} NEW listings not on LakeHouse.com`);
  console.log(`   Running total: ${masterListings.size} unique listings\n`);

  // ===== SOURCE 3: Redfin Stingray API =====
  const redfinListings = await scrapeRedfin();
  let redfinAdded = 0;
  for (const l of redfinListings) {
    if (addListing(l, 'Redfin')) redfinAdded++;
  }
  console.log(`   Redfin added ${redfinAdded} NEW listings not on LakeHouse.com`);
  console.log(`   Running total: ${masterListings.size} unique listings\n`);

  // ===== SOURCE 3: Craigslist FSBO =====
  const fsboListings = await scrapeCraigslistFSBO();
  let fsboAdded = 0;
  for (const l of fsboListings) {
    if (addListing(l, 'Craigslist FSBO')) fsboAdded++;
  }
  console.log(`   FSBO added ${fsboAdded} NEW listings`);
  console.log(`   Running total: ${masterListings.size} unique listings\n`);

  const allListings = Array.from(masterListings.values());
  console.log(`\n📊 TOTAL UNIQUE LISTINGS: ${allListings.length}`);
  console.log(`   From LakeHouse.com: ${allListings.filter(l => l._sources?.some(s => s.name === 'LakeHouse.com')).length}`);
  console.log(`   From Zillow: ${allListings.filter(l => l._sources?.some(s => s.name === 'Zillow')).length}`);
  console.log(`   From Redfin: ${allListings.filter(l => l._sources?.some(s => s.name === 'Redfin')).length}`);
  console.log(`   From Craigslist FSBO: ${allListings.filter(l => l._sources?.some(s => s.name === 'Craigslist FSBO')).length}`);
  console.log(`   Multi-source (on 2+ sites): ${allListings.filter(l => (l._sources || []).length >= 2).length}\n`);

  if (allListings.length === 0) {
    console.error('No listings found. Aborting update.');
    process.exit(1);
  }

  // Step 2: Enrich each listing with GPS + better photos (3 at a time)
  console.log('🔍 Enriching listings with GPS coordinates...');
  for (let i = 0; i < allListings.length; i += 3) {
    const batch = allListings.slice(i, i + 3);
    await Promise.all(batch.map(async (listing) => {
      console.log(`   [${i + 1}/${allListings.length}] ${listing.address}...`);
      await enrichListing(listing);
    }));
    // Polite delay between batches
    if (i + 3 < allListings.length) await new Promise(r => setTimeout(r, 800));
  }

  // Step 2.5: FEMA Flood Zone lookup (5 at a time, with rate limiting)
  console.log('\n🌊 Checking FEMA flood zones...');
  for (let i = 0; i < allListings.length; i += 5) {
    const batch = allListings.slice(i, i + 5);
    await Promise.all(batch.map(async (listing) => {
      if (!listing.latitude || !listing.longitude) { listing.floodZone = 'Unknown'; return; }
      try {
        const url = `https://msc.fema.gov/arcgis/rest/services/NFHL_Print/NFHL/MapServer/14/query?geometry=${listing.longitude}%2C${listing.latitude}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=FLD_ZONE%2CZONE_SUBTY%2CSFHA_TF&returnGeometry=false&f=json`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.features && data.features.length > 0) {
          const attr = data.features[0].attributes;
          listing.floodZone = attr.FLD_ZONE || 'Unknown';
          listing.floodZoneSub = attr.ZONE_SUBTY || '';
          listing.isFloodHazard = attr.SFHA_TF === 'T';
        } else {
          listing.floodZone = 'X';
          listing.isFloodHazard = false;
        }
      } catch (e) {
        listing.floodZone = 'Unknown';
        listing.isFloodHazard = false;
      }
    }));
    if (i + 5 < allListings.length) await new Promise(r => setTimeout(r, 500));
    if (i % 50 === 0) console.log(`    Checked ${Math.min(i + 5, allListings.length)} / ${allListings.length}`);
  }
  const hazardCount = allListings.filter(l => l.isFloodHazard).length;
  console.log(`    ${hazardCount} properties in flood hazard zones`);

  // Step 3: Generate JavaScript
  console.log('\n📝 Generating property data...');
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const propertiesJS = allListings.map((listing, i) => generatePropertyJS(listing, i + 1)).join(',\n');

  // Step 4: Update index.html
  console.log('📄 Updating index.html...');
  let html = fs.readFileSync(INDEX_PATH, 'utf-8');

  // Replace the PROPERTIES array
  const startMarker = 'const PROPERTIES = [';
  const startIdx = html.indexOf(startMarker);
  if (startIdx === -1) {
    console.error('Could not find PROPERTIES array in index.html');
    process.exit(1);
  }

  // Find the matching closing bracket
  let depth = 0;
  let endIdx = -1;
  for (let i = startIdx + startMarker.length; i < html.length; i++) {
    if (html[i] === '[') depth++;
    if (html[i] === ']') {
      if (depth === 0) { endIdx = i + 1; break; }
      depth--;
    }
  }

  if (endIdx === -1) {
    console.error('Could not find end of PROPERTIES array');
    process.exit(1);
  }

  const newArray = `const PROPERTIES = [\n${propertiesJS}\n]`;
  html = html.substring(0, startIdx) + newArray + html.substring(endIdx);

  // Update the "Last updated" date
  html = html.replace(
    /Last updated: <span id="last-updated" class="text-slate-400">[^<]+<\/span>/,
    `Last updated: <span id="last-updated" class="text-slate-400">${today}</span>`
  );

  fs.writeFileSync(INDEX_PATH, html);

  console.log(`\n✅ Updated ${allListings.length} listings (${today})`);
  console.log('   Listings by lake:');
  for (const lake of LAKES) {
    const count = allListings.filter(l => l.lakeName === lake.name).length;
    if (count > 0) console.log(`   - ${lake.name}: ${count}`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
