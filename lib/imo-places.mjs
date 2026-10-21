// Approximate positions for IMO register location text such as "68 NM from Al
// Jubail", "Off Hodeidah" or "Gulf of Oman". Every result is a derived
// approximation with a radius, never a reported fix. Unrecognized, truncated,
// country-only and direction-without-distance text returns null: never guess.
//
// Coordinates are city, town, port or island reference points, not the exact
// point a reporter measured from. Each entry names the page coordinates it was
// checked against on 2026-10-21 (English Wikipedia page coordinates, or the
// GeoNames feature where Wikipedia has none).
const place=(id,name,country,lat,lon,source,aliases=[],extentNm=0)=>Object.freeze({id,name,country,lat,lon,source,aliases:Object.freeze(aliases),extentNm});
export const PLACES=Object.freeze([
  // Red Sea, Bab el-Mandeb and Gulf of Aden
  place('hodeidah','Hodeidah','Yemen',14.80222,42.95111,'Wikipedia',['Al Hudaydah','Hudaydah','Hodeida','Port of Hodeidah']),
  place('ras-isa','Ras Isa','Yemen',15.19073,42.66366,'GeoNames: Ras Isa Marine Terminal',['Ras Issa','Ras Isa terminal','Ras Isa oil terminal']),
  place('salif','Salif','Yemen',15.31083,42.67306,'Wikipedia: As-Salif',['As Salif','Al Salif']),
  place('mocha','Mocha','Yemen',13.32028,43.25,'Wikipedia: Mokha',['Mokha','Al Mukha']),
  place('aden','Aden','Yemen',12.8,45.03333,'Wikipedia'),
  place('port-of-aden','Port of Aden','Yemen',12.7912,44.9855,'Wikipedia',['Aden port']),
  place('mukalla','Mukalla','Yemen',14.53333,49.13333,'Wikipedia',['Al Mukalla']),
  place('nishtun','Nishtun','Yemen',15.82389,52.18417,'Wikipedia',['Nishtoon']),
  // Country names are qualifiers, not reference points, so bare "Djibouti" is not an alias.
  place('djibouti','Djibouti City','Djibouti',11.59444,43.14806,'Wikipedia',['Port of Djibouti','Djibouti port']),
  place('assab','Assab','Eritrea',13.01667,42.73333,'Wikipedia',['Aseb']),
  place('berbera','Berbera','Somalia',10.43556,45.01639,'Wikipedia'),
  place('port-sudan','Port Sudan','Sudan',19.60194,37.2075,'Wikipedia'),
  place('jeddah','Jeddah','Saudi Arabia',21.54333,39.17278,'Wikipedia',['Jiddah','Jedda']),
  place('yanbu','Yanbu','Saudi Arabia',24.08944,38.06194,'Wikipedia',['Yanbu al Bahr']),
  place('eilat','Eilat','Israel',29.55694,34.95167,'Wikipedia'),
  place('aqaba','Aqaba','Jordan',29.53194,35.00556,'Wikipedia'),
  place('suez','Suez','Egypt',29.96667,32.55,'Wikipedia'),
  // Persian Gulf
  place('al-jubail','Al Jubail','Saudi Arabia',27,49.65444,'Wikipedia: Jubail',['Jubail','Al Jubayl','Jubayl']),
  place('ras-tanura','Ras Tanura','Saudi Arabia',26.70639,50.05278,'Wikipedia'),
  place('dammam','Dammam','Saudi Arabia',26.43333,50.1,'Wikipedia'),
  place('kuwait-city','Kuwait City','Kuwait',29.36972,47.97833,'Wikipedia'),
  place('bubiyan','Bubiyan Island','Kuwait',29.78333,48.18333,'Wikipedia',['Bubiyan'],12),
  place('basra','Basra','Iraq',30.515,47.81,'Wikipedia',['Basrah']),
  place('umm-qasr','Umm Qasr','Iraq',30.03417,47.92944,'Wikipedia',['Umm Qasr Port','Port of Umm Qasr']),
  place('khor-al-zubair','Khor Al Zubair','Iraq',30.19694,47.885,'Wikipedia: Khor Al Zubair Port',['Khawr az Zubayr']),
  place('al-faw','Al-Faw','Iraq',29.97583,48.47222,'Wikipedia',['Faw','Fao','Al Fao']),
  place('kharg','Kharg Island','Iran',29.245,50.31,'Wikipedia',['Kharg'],3),
  place('bushehr','Bushehr','Iran',28.92639,50.85139,'Wikipedia',['Bushire','Bandar Bushehr']),
  place('kish','Kish Island','Iran',26.535,53.975,'Wikipedia',['Kish'],4),
  place('bandar-lengeh','Bandar Lengeh','Iran',26.55944,54.885,'Wikipedia',['Lengeh']),
  place('qeshm','Qeshm Island','Iran',26.7675,55.7725,'Wikipedia',['Qeshm'],30),
  place('bandar-abbas','Bandar Abbas','Iran',27.19611,56.28778,'Wikipedia'),
  place('hormuz-island','Hormuz Island','Iran',27.0675,56.46,'Wikipedia',['Hormoz Island'],3),
  place('larak','Larak Island','Iran',26.85,56.35,'Wikipedia',['Larak'],3),
  place('sirik','Sirik','Iran',26.51639,57.10167,'Wikipedia: Bandar Sirik',['Bandar Sirik']),
  place('jask','Jask','Iran',25.65306,57.78167,'Wikipedia',['Bandar-e Jask']),
  place('chabahar','Chabahar','Iran',25.29278,60.64972,'Wikipedia'),
  place('gwadar','Gwadar','Pakistan',25.12639,62.3225,'Wikipedia'),
  place('manama','Manama','Bahrain',26.22333,50.5875,'Wikipedia'),
  // Bahrain's two commercial ports are about 6 NM apart; the vicinity radius covers both.
  place('mina-salman','Mina Salman','Bahrain',26.201,50.607,'Wikipedia',['Port of Bahrain','Mina Salman Port']),
  place('khalifa-bin-salman-port','Khalifa Bin Salman Port','Bahrain',26.19,50.714,'Wikipedia'),
  place('doha','Doha','Qatar',25.28667,51.53333,'Wikipedia'),
  place('hamad-port','Hamad Port','Qatar',25.015,51.602,'Wikipedia'),
  place('mesaieed','Mesaieed','Qatar',24.98,51.55,'Wikipedia',['Umm Said']),
  place('ras-laffan','Ras Laffan','Qatar',25.8575,51.53889,'Wikipedia: Ras Laffan Industrial City',['Ras Laffan Industrial City']),
  place('madinat-ash-shamal','Madinat ash Shamal','Qatar',26.11667,51.21667,'Wikipedia',['Madinat al Shamal','Al Shamal']),
  place('das-island','Das Island','United Arab Emirates',25.15139,52.87361,'Wikipedia',['Das']),
  place('khalifa-port','Khalifa Port','United Arab Emirates',24.83333,54.66667,'Wikipedia'),
  place('jebel-ali','Jebel Ali','United Arab Emirates',25.01126,55.06116,'Wikipedia',['Jabal Ali','Port of Jebel Ali','Jebel Ali Port']),
  place('dubai','Dubai','United Arab Emirates',25.20472,55.27083,'Wikipedia',[],6),
  place('port-rashid','Port Rashid','United Arab Emirates',25.27481,55.29041,'Wikipedia',['Mina Rashid']),
  place('ras-al-khaimah','Ras Al Khaimah','United Arab Emirates',25.76667,55.95,'Wikipedia',['Ras al Khaymah','RAK']),
  place('mina-saqr','Mina Saqr','United Arab Emirates',25.973611,56.046944,'GeoNames: Mina’ Saqr (port)',['Saqr Port','Port Saqr']),
  // Gulf of Oman and Arabian Sea
  place('fujairah','Fujairah','United Arab Emirates',25.12222,56.33444,'Wikipedia: Fujairah City',['Fujairah City']),
  place('port-of-fujairah','Port of Fujairah','United Arab Emirates',25.18806,56.35972,'Wikipedia',['Fujairah Port']),
  place('khor-fakkan','Khor Fakkan','United Arab Emirates',25.33333,56.35,'Wikipedia',['Khorfakkan','Khawr Fakkan','Port of Khor Fakkan']),
  // The Dibba area spans Fujairah, Sharjah and Oman within about 3 NM.
  place('dibba','Dibba','United Arab Emirates',25.61667,56.26667,'Wikipedia',['Diba']),
  place('dibba-al-fujairah','Dibba Al-Fujairah','United Arab Emirates',25.58361,56.25556,'Wikipedia',['Dibba Fujairah']),
  place('dibba-al-hisn','Dibba Al-Hisn','United Arab Emirates',25.61889,56.27333,'Wikipedia'),
  place('dibba-al-baya','Dibba Al-Baya','Oman',25.64,56.26667,'Wikipedia'),
  place('khasab','Khasab','Oman',26.18333,56.25,'Wikipedia',['Al Khasab']),
  place('port-of-khasab','Port of Khasab','Oman',26.20333,56.24944,'Wikipedia',['Khasab Port']),
  place('bukha','Bukha','Oman',26.14306,56.15306,'Wikipedia'),
  place('kumzar','Kumzar','Oman',26.33667,56.40972,'Wikipedia'),
  // The Musandam names below have no Wikipedia coordinates. GeoNames records
  // the register spellings as alternate names of these Musandam features. The
  // only other Omani "Ash Shishah" is inland in Ad Dakhiliyah.
  place('limah','Limah','Oman',25.942051,56.424192,'GeoNames: Līmā’',['Lima','Al Limah']),
  place('shisah','Shisah','Oman',26.26184,56.394,'GeoNames: Shīşah (alternate name Ash Shishah)',['Ash Shishah','Shishah','Shisha']),
  place('tihayt','Tihayt','Oman',26.31151,56.45029,'GeoNames: Ţiḩayt (alternate name Dahit)',['Dahit']),
  place('umm-al-fayyarin','Umm al Fayyarin','Oman',26.17893,56.54651,'GeoNames: Jazīrat Umm al Fayyārīn (island)',['Umm Al-Fayarin','Jazirat Umm al Fayyarin']),
  place('shinas','Shinas','Oman',24.75,56.46667,'Wikipedia'),
  place('sohar','Sohar','Oman',24.342,56.72989,'Wikipedia'),
  place('port-of-sohar','Port of Sohar','Oman',24.50417,56.61028,'Wikipedia: SOHAR Port and Freezone',['Sohar Port']),
  place('muscat','Muscat','Oman',23.58889,58.40833,'Wikipedia'),
  place('sur','Sur','Oman',22.56667,59.52889,'Wikipedia: Sur, Oman'),
  place('ras-al-hadd','Ras al Hadd','Oman',22.517,59.767,'Wikipedia'),
  place('masirah','Masirah Island','Oman',20.47111,58.81528,'Wikipedia',['Masirah'],18),
  place('duqm','Duqm','Oman',19.66167,57.70472,'Wikipedia',['Ad Duqm']),
  place('salalah','Salalah','Oman',17.01972,54.08972,'Wikipedia'),
  place('port-of-salalah','Port of Salalah','Oman',16.94806,54.00889,'Wikipedia',['Salalah Port']),
]);

// Nominal centres and radii for named waters. Wikipedia page coordinates are
// used where they exist; the southern Red Sea centre is Passage's own nominal
// point between Eritrea and Yemen at 15°N. Bare "Red Sea" maps to the southern
// Red Sea because this dashboard's Red Sea theatre is Bab el-Mandeb.
const area=(id,name,lat,lon,radiusNm,coastalStates,aliases,source)=>Object.freeze({id,name,lat,lon,radiusNm,coastalStates:Object.freeze(coastalStates),aliases:Object.freeze(aliases),source});
export const SEA_AREAS=Object.freeze([
  area('southern-red-sea','Southern Red Sea',15,41.6,180,['Yemen','Eritrea','Saudi Arabia','Djibouti'],['Red Sea','South Red Sea'],'Passage nominal centre'),
  area('bab-el-mandeb','Bab el-Mandeb',12.58333,43.33333,25,['Yemen','Djibouti','Eritrea'],['Bab al Mandab','Bab al-Mandab Strait','Bab el-Mandeb Strait','Strait of Bab el-Mandeb'],'Wikipedia: Bab-el-Mandeb'),
  area('gulf-of-aden','Gulf of Aden',12,48,240,['Yemen','Djibouti','Somalia'],[],'Wikipedia'),
  area('strait-of-hormuz','Strait of Hormuz',26.6,56.5,45,['Oman','Iran','United Arab Emirates'],['Hormuz Strait','Straits of Hormuz'],'Wikipedia'),
  area('gulf-of-oman','Gulf of Oman',25,58,170,['Oman','Iran','United Arab Emirates','Pakistan'],['Sea of Oman','Oman Sea'],'Wikipedia'),
  area('persian-gulf','Persian Gulf',26,52,280,['Iran','Iraq','Kuwait','Saudi Arabia','Bahrain','Qatar','United Arab Emirates','Oman'],['Arabian Gulf','Persian/Arabian Gulf','Arabian/Persian Gulf'],'Wikipedia'),
  area('arabian-sea','Arabian Sea',14,65,600,['Oman','Yemen','Pakistan','Iran','India','Somalia'],['North Arabian Sea','Northern Arabian Sea'],'Wikipedia'),
]);

const COUNTRIES=Object.freeze({
  'oman':'Oman','sultanate of oman':'Oman','uae':'United Arab Emirates','united arab emirates':'United Arab Emirates',
  'saudi arabia':'Saudi Arabia','ksa':'Saudi Arabia','kingdom of saudi arabia':'Saudi Arabia','qatar':'Qatar','iraq':'Iraq',
  'iran':'Iran','islamic republic of iran':'Iran','ir iran':'Iran','kuwait':'Kuwait','bahrain':'Bahrain','kingdom of bahrain':'Bahrain',
  'yemen':'Yemen','pakistan':'Pakistan','djibouti':'Djibouti','eritrea':'Eritrea','somalia':'Somalia','somaliland':'Somalia',
  'sudan':'Sudan','egypt':'Egypt','israel':'Israel','jordan':'Jordan','india':'India',
});
// Sixteen-point compass bearings in degrees true.
const BEARINGS=Object.freeze(Object.fromEntries(['n','nne','ne','ene','e','ese','se','sse','s','ssw','sw','wsw','w','wnw','nw','nnw'].map((key,i)=>[key,i*22.5])));
const EARTH_RADIUS_NM=3440.065; // IUGG mean Earth radius 6371.0088 km / 1.852 km per NM
const VICINITY_NM=12,ROUNDING_NM=1,REFERENCE_SLACK_NM=3,MAX_DISTANCE_NM=400;
// Results outside the monitored region are rejected as a wrong-reference guard.
const REGION=Object.freeze({south:-2,north:32,west:30,east:76});
const rad=deg=>deg*Math.PI/180,deg=r=>r*180/Math.PI;
// Offsets are rounded to 5 decimals (about 1 m); reference points are returned as listed.
const round=value=>Number(value.toFixed(5));

function key(value) {
  return value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/['\u2018\u2019\u02bc`\u00b4.]/g,'')
    .replace(/[-\u2010-\u2015/_]+/g,' ').replace(/\s+/g,' ').trim();
}
const INDEX=new Map();
for(const [kind,entries] of [['place',PLACES],['sea-area',SEA_AREAS]])for(const entry of entries)for(const name of [entry.name,...entry.aliases]) {
  const id=key(name);
  // An alias may name only one reference, and a country is never a reference point.
  if(INDEX.has(id)||Object.hasOwn(COUNTRIES,id))throw new Error(`Gazetteer alias is ambiguous: ${name}`);
  INDEX.set(id,{...entry,kind});
}

// Great-circle distance (haversine), nautical miles.
export function distanceNm(a,b) {
  const dLat=rad(b.lat-a.lat),dLon=rad(b.lon-a.lon);
  const h=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;
  return 2*EARTH_RADIUS_NM*Math.asin(Math.min(1,Math.sqrt(h)));
}

// Great-circle destination from a start point, initial bearing and distance.
// https://www.movable-type.co.uk/scripts/latlong.html#destPoint
export function destinationPoint(lat,lon,bearingDeg,distance) {
  const p1=rad(lat),l1=rad(lon),theta=rad(bearingDeg),delta=distance/EARTH_RADIUS_NM;
  const p2=Math.asin(Math.sin(p1)*Math.cos(delta)+Math.cos(p1)*Math.sin(delta)*Math.cos(theta));
  const l2=l1+Math.atan2(Math.sin(theta)*Math.sin(delta)*Math.cos(p1),Math.cos(delta)-Math.sin(p1)*Math.sin(p2));
  return {lat:deg(p2),lon:((deg(l2)+540)%360)-180};
}

function bearing(label) {
  const compact=label.toLowerCase().replace(/[\s-]+/g,'').replace(/north/g,'n').replace(/south/g,'s').replace(/east/g,'e').replace(/west/g,'w');
  return Object.hasOwn(BEARINGS,compact)?{degrees:BEARINGS[compact],points:compact.length===3?16:8}:null;
}

function lookup(name) {
  const exact=key(name),noArticle=exact.replace(/^the /,''),noArea=noArticle.replace(/ area$/,'');
  const noFacility=noArea.replace(/^port of /,'').replace(/ (?:anchorage|port|harbou?r|(?:oil )?terminal)$/,'');
  for(const candidate of [exact,noArticle,noArea,noFacility])if(INDEX.has(candidate))return INDEX.get(candidate);
  return null;
}

// "Place, Country", "Place, Sea area" and "Sea area - Country TTW" qualifiers
// must agree with the resolved reference; any other qualifier makes it unknown.
function reference(text) {
  const parts=text.split(',').map(part=>part.trim());
  if(parts.length>3||parts.some(part=>!part))return null;
  let [head,...qualifiers]=parts;
  const territorial=head.match(/^(.+?)\s+[-\u2013\u2014]\s+(.+?)\s+(?:TTW|territorial waters)$/i);
  if(territorial){head=territorial[1];qualifiers=[territorial[2],...qualifiers];}
  const entry=lookup(head);if(!entry)return null;
  for(const qualifier of qualifiers) {
    const country=COUNTRIES[key(qualifier)],water=lookup(qualifier);
    if(country){if(entry.kind==='sea-area'?!entry.coastalStates.includes(country):entry.country!==country)return null;}
    else if(water?.kind==='sea-area'){if(distanceNm(entry,water)>water.radiusNm+60)return null;}
    else return null;
  }
  return entry;
}

const DIRECTION='((?:north|south|east|west)(?:[\\s-]?(?:north|south|east|west)){0,2}|[nsew]{1,3})';
const OFFSET=new RegExp(`^(?:(?:approximately|approx\\.?|about|around|some|~)\\s*)?(\\d{1,4}(?:\\.\\d{1,2})?)\\s*(?:nm|nmi|nautical\\s+miles?)\\s+(?:${DIRECTION}\\s+)?(?:of|from|off)\\s+(.+)$`,'i');
const DIRECTION_ONLY=new RegExp(`^${DIRECTION}\\s+of\\s+.+$`,'i');
const VICINITY=/^(?:off|near|ivo|in the vicinity of|vicinity of|close to|at berth,?|at anchor(?:age)?,?(?:\s+(?:off|near|in))?|anchored(?:\s+(?:off|near|at|in))?|alongside(?:\s+at)?|at|in)\s+(.+)$/i;

function result(lat,lon,radiusNm,basis,entry) {
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||!Number.isFinite(radiusNm)||radiusNm<=0)return null;
  if(lat<REGION.south||lat>REGION.north||lon<REGION.west||lon>REGION.east)return null;
  return {lat,lon,radiusNm:Math.ceil(radiusNm),precision:'approximate',basis,reference:entry.name};
}

// Returns {lat, lon, radiusNm, precision:'approximate', basis, reference} or null.
// basis: 'bearing-distance' | 'distance-only' | 'vicinity' | 'sea-area'.
export function locateIncident(input) {
  if(typeof input!=='string')return null;
  const text=input.normalize('NFKC').replace(/[\u00a0\u2000-\u200b\u202f]/g,' ').replace(/[\u2018\u2019\u02bc]/g,"'").replace(/\s+/g,' ').trim().replace(/\.$/,'');
  if(!text||text.length>300)return null;
  const offset=text.match(OFFSET);
  if(offset) {
    const [,distanceLabel,directionLabel,placeLabel]=offset,distance=Number(distanceLabel);
    if(!Number.isFinite(distance)||distance<=0||distance>MAX_DISTANCE_NM)return null;
    const entry=reference(placeLabel);
    // A distance from a sea area, or from an unknown place, has no reference point.
    if(!entry||entry.kind!=='place')return null;
    if(!directionLabel)return result(entry.lat,entry.lon,distance+entry.extentNm,'distance-only',entry);
    const heading=bearing(directionLabel);if(!heading)return null;
    const point=destinationPoint(entry.lat,entry.lon,heading.degrees,distance);
    // Lateral uncertainty of a compass sector (±22.5° for 8-point names, ±11.25°
    // for 16-point names), plus distance rounding and reference-point slack.
    const sector=distance*Math.sin(rad(180/heading.points));
    return result(round(point.lat),round(point.lon),sector+ROUNDING_NM+REFERENCE_SLACK_NM+entry.extentNm,'bearing-distance',entry);
  }
  // "Northeast of Khor Fakkan" gives no distance; any point would be invented.
  if(DIRECTION_ONLY.test(text))return null;
  const vicinity=text.match(VICINITY),entry=reference(vicinity?vicinity[1]:text);
  if(!entry)return null;
  if(entry.kind==='sea-area')return result(entry.lat,entry.lon,entry.radiusNm,'sea-area',entry);
  return result(entry.lat,entry.lon,VICINITY_NM+entry.extentNm,'vicinity',entry);
}
