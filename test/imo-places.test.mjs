import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MARITIME_FEEDS,parseMaritimePage} from '../lib/maritime.mjs';
import {PLACES,SEA_AREAS,locateIncident,destinationPoint,distanceNm} from '../lib/imo-places.mjs';

// Real IMO register captured 2026-10-21; see fixtures/imo/provenance.json.
const html=await readFile(new URL('./fixtures/imo/middle-east-highlighted-incidents.html',import.meta.url),'utf8');
const events=parseMaritimePage(html,MARITIME_FEEDS.find(feed=>feed.id==='imo-hormuz'),Date.parse('2026-10-21T15:00:00Z'));
const locations=[...new Set(events.map(event=>event.locationText))];
const place=name=>PLACES.find(entry=>entry.name===name);
const close=(actual,expected,tolerance,label)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${label}: ${actual} vs ${expected}`);
function initialBearing(a,b) {
  const rad=Math.PI/180,p1=a.lat*rad,p2=b.lat*rad,dl=(b.lon-a.lon)*rad;
  return (Math.atan2(Math.sin(dl)*Math.cos(p2),Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl))/rad+360)%360;
}

// Every real string that is not located is listed with the reason it stays null.
const DELIBERATELY_NULL=new Map([
  ['Northeast of Khor Fakkan, UAE','direction without a distance'],
  ['Southeast of Strait of Hormuz','direction without a distance'],
  ['1 NM from the coast of Oman','a national coastline is not a reference point'],
  ['6NM from the coast of Oman','a national coastline is not a reference point'],
  ['8NM from the coast of Oman','a national coastline is not a reference point'],
  ['13 NM from the coast of Oman','a national coastline is not a reference point'],
  ['40 NM from the coast of Oman','a national coastline is not a reference point'],
  ['4NM east of Oman','country only'],
  ['9NM east of Oman','country only'],
  ['6NM east of Oman','country only'],
  ['8NM off Oman','country only'],
  ['15NM northeast of Oman','country only'],
  ['11NM north of Oman','country only'],
  ['6NM north of Oman','country only'],
  ['2NM north of Oman','country only'],
  ['8NM west of Islamic Republic of Iran','country only'],
  ['6NM east of Musandam Peninsula, Oman','a peninsula is not a reference point'],
  ['IVO Bushehr Province, Persian Gulf','a province is not a reference point'],
  ['2NM off the coast of Oman, near Jazirat','truncated place name'],
  ['112NM southeast of Ras Al','truncated place name'],
  ['13NM west of Al Jazeera, UAE','ambiguous: Al Jazirah Al Hamra (Ras Al Khaimah) or Al Jazirah (Sharjah)'],
  ['30NM southeast of Mubarak Al Kabeer, Kuwait','ambiguous: governorate seat or Mubarak Al-Kabeer Port on Bubiyan'],
]);

test('every distinct real IMO location string is either located in the region or deliberately null',()=>{
  assert.equal(events.length,118);assert.equal(locations.length,81);
  for(const text of DELIBERATELY_NULL.keys())assert.ok(locations.includes(text),`stale expectation: ${text}`);
  let located=0;
  for(const text of locations) {
    const result=locateIncident(text);
    if(DELIBERATELY_NULL.has(text)){assert.equal(result,null,`${text} should stay null: ${DELIBERATELY_NULL.get(text)}`);continue;}
    assert.ok(result,`unlocated: ${text}`);located++;
    assert.deepEqual(Object.keys(result).sort(),['basis','lat','lon','precision','radiusNm','reference']);
    assert.equal(result.precision,'approximate');
    assert.ok(['bearing-distance','distance-only','vicinity','sea-area'].includes(result.basis));
    assert.ok(Number.isInteger(result.radiusNm)&&result.radiusNm>0&&result.radiusNm<=170,text);
    // Every row in this register is in the Persian Gulf, Hormuz, Gulf of Oman or northern Arabian Sea.
    assert.ok(result.lat>19&&result.lat<31&&result.lon>47&&result.lon<63,`${text} -> ${result.lat},${result.lon}`);
    const reference=place(result.reference)||SEA_AREAS.find(entry=>entry.name===result.reference);
    assert.ok(reference,text);assert.ok(distanceNm(reference,result)<=80,text);
  }
  assert.equal(located,59);
  assert.equal(events.filter(event=>locateIncident(event.locationText)).length,94);
});

test('bearing offsets follow the great-circle destination formula',()=>{
  // 60 NM along the equator is 60/3440.065 radians of longitude.
  const east=destinationPoint(0,0,90,60);
  close(east.lat,0,1e-9,'equator lat');close(east.lon,60/3440.065*180/Math.PI,1e-9,'equator lon');
  const north=destinationPoint(10,50,0,60);
  close(north.lat,10+60/3440.065*180/Math.PI,1e-9,'north lat');close(north.lon,50,1e-9,'north lon');
  const wrapped=destinationPoint(0,179.9,90,60);
  close(wrapped.lon,179.9+60/3440.065*180/Math.PI-360,1e-9,'antimeridian wrap');
  for(let bearing=0;bearing<360;bearing+=22.5) {
    const point=destinationPoint(12.8,45.03,bearing,45);
    close(distanceNm({lat:12.8,lon:45.03},point),45,1e-6,`round trip ${bearing}`);
    close((initialBearing({lat:12.8,lon:45.03},point)-bearing+540)%360-180,0,1e-6,`bearing ${bearing}`);
  }
});

test('register offsets land at the stated distance and compass bearing from the named reference',()=>{
  const jubail=place('Al Jubail'),ne=locateIncident('78 NM northeast of Al Jubail, Saudi Arabia');
  assert.equal(ne.basis,'bearing-distance');assert.equal(ne.reference,'Al Jubail');
  close(distanceNm(jubail,ne),78,0.02,'Al Jubail distance');close(initialBearing(jubail,ne),45,0.05,'Al Jubail bearing');
  // Flat-earth cross-check: about 0.92 degrees of latitude and 1.03 of longitude.
  close(ne.lat-jubail.lat,78*Math.SQRT1_2/60,0.01,'Al Jubail dlat');close(ne.lon-jubail.lon,78*Math.SQRT1_2/60/Math.cos(27.46*Math.PI/180),0.01,'Al Jubail dlon');
  // 8-point sector: 78*sin(22.5°)=29.85, plus 1 NM rounding and 3 NM reference slack.
  assert.equal(ne.radiusNm,34);
  const gwadar=place('Gwadar'),south=locateIncident('70NM south of Gwadar, Pakistan');
  close(south.lat,gwadar.lat-70/3440.065*180/Math.PI,1e-4,'Gwadar lat');close(south.lon,gwadar.lon,1e-4,'Gwadar lon');
  const khasab=place('Khasab'),west=locateIncident('4NM west of Khasab, Oman');
  assert.ok(west.lon<khasab.lon);close(west.lat,khasab.lat,0.001,'Khasab lat');close(distanceNm(khasab,west),4,0.01,'Khasab distance');
  const dahit=locateIncident('7.5NM southeast of Dahit, Oman');
  close(distanceNm(place('Tihayt'),dahit),7.5,0.01,'decimal distance');close(initialBearing(place('Tihayt'),dahit),135,0.05,'southeast');
  const dubai=locateIncident('31NM NW of Dubai, UAE');close(initialBearing(place('Dubai'),dubai),315,0.05,'abbreviated NW');
  const alFaw=locateIncident('28NM south-east of Al-Faw, Iraq');close(initialBearing(place('Al-Faw'),alFaw),135,0.05,'hyphenated south-east');
  const curly=locateIncident('25NM northwest of Ra’s al Khaymah, UAE');assert.equal(curly.reference,'Ras Al Khaimah');
});

test('distance-only, vicinity and sea-area references keep the reference point and widen the radius',()=>{
  const jubail=place('Al Jubail');
  assert.deepEqual(locateIncident('68 NM from Al Jubail'),{lat:jubail.lat,lon:jubail.lon,radiusNm:68,precision:'approximate',basis:'distance-only',reference:'Al Jubail'});
  const hodeidah=place('Hodeidah');
  assert.deepEqual(locateIncident('Off Hodeidah'),{lat:hodeidah.lat,lon:hodeidah.lon,radiusNm:12,precision:'approximate',basis:'vicinity',reference:'Hodeidah'});
  assert.deepEqual(locateIncident('10NM off Mocha'),{lat:place('Mocha').lat,lon:place('Mocha').lon,radiusNm:10,precision:'approximate',basis:'distance-only',reference:'Mocha'});
  assert.equal(locateIncident('Near Duqm, Oman').basis,'vicinity');
  assert.equal(locateIncident('Al Jubayl, Saudi Arabia').reference,'Al Jubail');
  assert.equal(locateIncident('Sohar Anchorage, Gulf of Oman').reference,'Sohar');
  assert.equal(locateIncident('Near Khor Al Zubair Port, Iraq').reference,'Khor Al Zubair');
  assert.equal(locateIncident('At Berth, Port of Bahrain').reference,'Mina Salman');
  // Island references add half their length so a bearing from the centre is not overstated.
  assert.equal(locateIncident('Off Masirah').radiusNm,30);
  for(const [text,name,radius] of [['Strait of Hormuz','Strait of Hormuz',45],['Near Strait of Hormuz','Strait of Hormuz',45],['Strait of Hormuz - Oman TTW','Strait of Hormuz',45],
    ['Red Sea','Southern Red Sea',180],['In the southern Red Sea','Southern Red Sea',180],['Bab el-Mandeb','Bab el-Mandeb',25],['Bab al-Mandab','Bab el-Mandeb',25],
    ['Gulf of Aden','Gulf of Aden',240],['Gulf of Oman','Gulf of Oman',170],['Persian/Arabian Gulf','Persian Gulf',280],['Arabian Gulf','Persian Gulf',280],['Arabian Sea','Arabian Sea',600]]) {
    const result=locateIncident(text),entry=SEA_AREAS.find(item=>item.name===name);
    assert.deepEqual(result,{lat:entry.lat,lon:entry.lon,radiusNm:radius,precision:'approximate',basis:'sea-area',reference:name},text);
  }
});

test('tricky formats parse, and unknown, inconsistent or unsupported text never guesses',()=>{
  const wnw=locateIncident('approximately 30 nautical miles west-northwest of Aden');
  assert.equal(wnw.basis,'bearing-distance');close(initialBearing(place('Aden'),wnw),292.5,0.05,'west-northwest');
  // 16-point sector: 30*sin(11.25°)=5.85, plus 4 NM.
  assert.equal(wnw.radiusNm,10);
  close(initialBearing(place('Hodeidah'),locateIncident('5 NM SSE of Hodeidah')),157.5,0.05,'SSE');
  close(initialBearing(place('Mocha'),locateIncident('12 nm N of Mocha.')),0,0.05,'N');
  close(initialBearing(place('Assab'),locateIncident('20 NM north east of Assab, Eritrea')),45,0.05,'north east');
  assert.equal(locateIncident('Off Port of Djibouti').reference,'Djibouti City');
  assert.equal(locateIncident('15 NM W of Berbera, Somaliland').reference,'Berbera');
  for(const text of [
    'Off Djibouti','12 NM east of Kuwait','Red Sea area (statement scope)','20NM east of Gulf of Aden','Southeast of Aden',
    'Hodeidah, Oman','Ash Shishah, Saudi Arabia','Aden, Gulf of Oman','Strait of Hormuz - Yemen TTW','Off Hodeidah, near the port',
    '12 km west of Aden','500NM east of Aden','10 NM nnnw of Aden','10 NM ns of Aden','0 NM east of Aden','NM east of Aden',
    'Off Atlantis','Off Lima, Peru','','   ','x'.repeat(301),
  ])assert.equal(locateIncident(text),null,text);
  for(const value of [null,undefined,42,{},['Aden']])assert.equal(locateIncident(value),null);
});

test('gazetteer covers the requested ports and waters with coordinates on the correct side of the world',()=>{
  for(const name of ['Hodeidah','Ras Isa','Salif','Mocha','Aden','Mukalla','Nishtun','Port of Djibouti','Assab','Berbera','Port Sudan','Jeddah','Yanbu','Eilat','Aqaba','Suez',
    'Al Jubail','Ras Tanura','Dammam','Kuwait City','Basra','Umm Qasr','Kharg Island','Bushehr','Bandar Abbas','Jask','Chabahar','Fujairah','Khor Fakkan','Dubai','Jebel Ali',
    'Ras al-Khaimah','Muscat','Sohar','Duqm','Salalah','Masirah','Ras al Hadd','Doha','Ras Laffan','Manama','Port of Bahrain'])
    assert.equal(locateIncident(`Off ${name}`)?.basis,'vicinity',name);
  // Approximate national extents catch swapped or sign-flipped coordinates.
  const extents={Yemen:[12,19,42,54],Oman:[16,27,51,60.5],'United Arab Emirates':[22.5,26.5,51,56.5],Iran:[25,40,44,63.5],'Saudi Arabia':[16,32.5,34.5,56],
    Qatar:[24.4,26.2,50.7,51.7],Bahrain:[25.5,26.4,50.3,50.9],Kuwait:[28.5,30.2,46.5,48.5],Iraq:[29,37.5,38.7,48.7],Pakistan:[23.5,37,60.8,77.9],
    Djibouti:[10.9,12.8,41.7,43.5],Eritrea:[12.3,18.1,36.4,43.2],Somalia:[-1.7,12,40.9,51.5],Sudan:[8.6,22.3,21.8,38.7],Egypt:[22,31.7,24.6,36.9],Israel:[29.4,33.4,34.2,35.9],Jordan:[29.1,33.4,34.9,39.3]};
  assert.equal(new Set(PLACES.map(entry=>entry.id)).size,PLACES.length);
  for(const entry of PLACES) {
    const [south,north,west,east]=extents[entry.country]||[];
    assert.ok(south!==undefined,`${entry.name}: unknown country ${entry.country}`);
    assert.ok(entry.lat>=south&&entry.lat<=north&&entry.lon>=west&&entry.lon<=east,`${entry.name} ${entry.lat},${entry.lon} outside ${entry.country}`);
    assert.ok(entry.source,entry.name);
  }
  for(const entry of SEA_AREAS)assert.ok(entry.lat>0&&entry.lat<30&&entry.lon>38&&entry.lon<70&&entry.radiusNm>0,entry.name);
});
