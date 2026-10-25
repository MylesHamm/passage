import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const data = JSON.parse(readFileSync(new URL('../dist/data/war-events.json', import.meta.url), 'utf8'));

const BOUNDS = {minLon: 22.5, maxLon: 67.5, minLat: 0, maxLat: 41};
const FIRST_DAY = '2026-02-28';
// The list is updated automatically, so its limits follow its own review time:
// a date, or a UTC date-time, never in the future.
const REVIEWED = data.reviewedAt;
const isReviewTime = value => typeof value === 'string' && (isDateString(value) || /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?Z$/.test(value) && isDateString(value.slice(0, 10)) && Number.isFinite(Date.parse(value)));
const LAST_DAY = typeof REVIEWED === 'string' ? REVIEWED.slice(0, 10) : '';
const LAYERS = ['shipping', 'missile-drone', 'strikes-on-iran-yemen'];
const TYPES = ['shipping-attack', 'seizure', 'mine', 'missile', 'drone', 'air-strike', 'naval-strike'];
const PRECISIONS = ['facility', 'city', 'area', 'sea-area'];
const CONFIDENCE = ['confirmed', 'claimed'];
const EVENT_KEYS = ['id', 'date', 'time', 'layer', 'type', 'actor', 'target', 'place', 'country', 'lat', 'lon', 'precision', 'confidence', 'title', 'summary', 'sources'];
const MISSION_KEYS = ['id', 'name', 'operator', 'start', 'end', 'area', 'polygon', 'labelAt', 'precision', 'sources'];
const SOURCE_KEYS = ['publisher', 'title', 'url', 'date'];

const isDateString = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
const isDate = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const nonEmpty = value => typeof value === 'string' && value.trim().length > 0;
const inBounds = (lon, lat) => Number.isFinite(lon) && Number.isFinite(lat) && lon >= BOUNDS.minLon && lon <= BOUNDS.maxLon && lat >= BOUNDS.minLat && lat <= BOUNDS.maxLat;
const inside = ([x, y], ring) => ring.reduce((acc, [x1, y1], i) => {
  const [x2, y2] = ring[(i + 1) % ring.length];
  return (y1 > y) !== (y2 > y) && x < (x2 - x1) * (y - y1) / (y2 - y1) + x1 ? !acc : acc;
}, false);
const host = url => new URL(url).hostname.toLowerCase();
const isWikipedia = url => host(url) === 'wikipedia.org' || host(url).endsWith('.wikipedia.org');

function checkSources(sources, label) {
  assert.ok(Array.isArray(sources) && sources.length > 0, `${label}: needs at least one source`);
  for (const source of sources) {
    assert.deepEqual(Object.keys(source).sort(), [...SOURCE_KEYS].sort(), `${label}: source keys`);
    assert.ok(nonEmpty(source.publisher), `${label}: source publisher`);
    assert.ok(nonEmpty(source.title), `${label}: source title`);
    assert.ok(isDate(source.date), `${label}: source date ${source.date}`);
    assert.equal(new URL(source.url).protocol, 'https:', `${label}: source must be https (${source.url})`);
  }
  assert.ok(sources.some(source => !isWikipedia(source.url)), `${label}: Wikipedia cannot be the only source`);
}

test('top-level schema', () => {
  assert.deepEqual(Object.keys(data).sort(), ['basis', 'events', 'missions', 'reviewedAt', 'schema']);
  assert.equal(data.schema, 'passage-war-events/v1');
  assert.ok(isReviewTime(data.reviewedAt), `review time ${data.reviewedAt}`);
  assert.ok(Date.parse(data.reviewedAt.length === 10 ? data.reviewedAt + 'T00:00:00Z' : data.reviewedAt) <= Date.now() + 300000, 'the review time is not in the future');
  assert.ok(nonEmpty(data.basis));
  assert.ok(Array.isArray(data.events) && data.events.length >= 70 && data.events.length <= 5000, `event count ${data.events.length}`);
  assert.ok(Array.isArray(data.missions) && data.missions.length > 0);
});

test('every event has exactly the documented fields', () => {
  for (const event of data.events) {
    assert.deepEqual(Object.keys(event).sort(), [...EVENT_KEYS].sort(), `fields of ${event.id}`);
    for (const key of ['actor', 'target', 'place', 'country']) assert.ok(nonEmpty(event[key]), `${event.id}: ${key}`);
  }
});

test('event ids are unique kebab-case and start with the event date', () => {
  const seen = new Set();
  for (const event of data.events) {
    assert.match(event.id, /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/, `id format ${event.id}`);
    assert.ok(event.id.startsWith(event.date + '-'), `${event.id} should start with ${event.date}`);
    assert.ok(!seen.has(event.id), `duplicate id ${event.id}`);
    seen.add(event.id);
  }
  const missionIds = data.missions.map(mission => mission.id);
  assert.equal(new Set(missionIds).size, missionIds.length, 'duplicate mission id');
});

test('event dates and times are valid and inside the war window', () => {
  for (const event of data.events) {
    assert.ok(isDate(event.date), `${event.id}: date ${event.date}`);
    assert.ok(event.date >= FIRST_DAY && event.date <= LAST_DAY, `${event.id}: date ${event.date} outside ${FIRST_DAY}..${LAST_DAY}`);
    assert.ok(event.time === null || /^([01]\d|2[0-3]):[0-5]\dZ$/.test(event.time), `${event.id}: time ${event.time}`);
  }
});

test('event coordinates are finite and inside the theatre map bounds', () => {
  for (const event of data.events) {
    assert.equal(typeof event.lat, 'number', `${event.id}: lat type`);
    assert.equal(typeof event.lon, 'number', `${event.id}: lon type`);
    assert.ok(inBounds(event.lon, event.lat), `${event.id}: ${event.lat},${event.lon} outside bounds`);
  }
});

test('layer, type, precision and confidence use the allowed values', () => {
  const typesByLayer = {
    shipping: ['shipping-attack', 'seizure', 'mine'],
    'missile-drone': ['missile', 'drone'],
    'strikes-on-iran-yemen': ['air-strike', 'naval-strike']
  };
  for (const event of data.events) {
    assert.ok(LAYERS.includes(event.layer), `${event.id}: layer ${event.layer}`);
    assert.ok(TYPES.includes(event.type), `${event.id}: type ${event.type}`);
    assert.ok(typesByLayer[event.layer].includes(event.type), `${event.id}: type ${event.type} does not fit layer ${event.layer}`);
    assert.ok(PRECISIONS.includes(event.precision), `${event.id}: precision ${event.precision}`);
    assert.ok(CONFIDENCE.includes(event.confidence), `${event.id}: confidence ${event.confidence}`);
  }
});

test('claimed events say so in the summary', () => {
  for (const event of data.events.filter(event => event.confidence === 'claimed')) {
    assert.match(event.summary, /claim/i, `${event.id}: claimed event summary must say claimed`);
  }
});

test('titles and summaries respect the length limits', () => {
  for (const event of data.events) {
    assert.ok(nonEmpty(event.title) && event.title.length <= 90, `${event.id}: title length ${event.title.length}`);
    assert.ok(nonEmpty(event.summary) && event.summary.length <= 240, `${event.id}: summary length ${event.summary.length}`);
  }
});

test('every event cites at least one https source with publisher, title and date, not only Wikipedia', () => {
  for (const event of data.events) checkSources(event.sources, event.id);
});

test('missions have valid dates, sources and closed or 3+ point polygons inside the bounds', () => {
  for (const mission of data.missions) {
    assert.deepEqual(Object.keys(mission).sort(), [...MISSION_KEYS].sort(), `fields of ${mission.id}`);
    for (const key of ['id', 'name', 'operator', 'area']) assert.ok(nonEmpty(mission[key]), `${mission.id}: ${key}`);
    assert.ok(isDate(mission.start), `${mission.id}: start`);
    assert.ok(mission.end === null || (isDate(mission.end) && mission.end >= mission.start), `${mission.id}: end`);
    assert.equal(mission.precision, 'approximate', `${mission.id}: precision`);
    assert.ok(Array.isArray(mission.polygon), `${mission.id}: polygon`);
    for (const point of mission.polygon) {
      assert.ok(Array.isArray(point) && point.length === 2, `${mission.id}: point shape`);
      assert.ok(inBounds(point[0], point[1]), `${mission.id}: point ${point} outside bounds`);
    }
    const first = mission.polygon[0];
    const last = mission.polygon.at(-1);
    const closed = mission.polygon.length >= 4 && first[0] === last[0] && first[1] === last[1];
    const distinct = new Set(mission.polygon.map(point => point.join(','))).size;
    assert.ok(closed || mission.polygon.length >= 3, `${mission.id}: polygon must be closed or have at least 3 points`);
    assert.ok(distinct >= 3, `${mission.id}: polygon needs at least 3 distinct points`);
    assert.ok(Array.isArray(mission.labelAt) && inside(mission.labelAt, mission.polygon), `${mission.id}: label point must sit inside its own area`);
    checkSources(mission.sources, mission.id);
  }
});

test('one article carries one publisher label wherever it is cited', () => {
  const labels = new Map();
  for (const event of data.events) for (const source of event.sources) {
    if (!labels.has(source.url)) labels.set(source.url, new Set());
    labels.get(source.url).add(source.publisher);
  }
  for (const [url, publishers] of labels) assert.equal(publishers.size, 1, `${url} is labelled ${[...publishers].join(' / ')}`);
});
