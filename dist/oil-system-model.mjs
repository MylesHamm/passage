import { oilMechanisms } from './situation-data.mjs';
import { sourceHealth, SOURCE_DEFINITIONS } from './source-health.mjs';

const DAY = 86400000;
const names = { both: 'Both theatres', hormuz: 'Strait of Hormuz', bab: 'Bab el-Mandeb' };

// EIA references explain mechanisms, not the current operating state of this
// schematic. No historical transit volume or disruption estimate is presented as live.
export const SYSTEM_STAGES = Object.freeze([
  {
    id: 'supply', title: 'Export availability', short: 'Production, storage and outlets',
    explanation: 'An interruption can reduce oil available for loading. Its effect depends on the volume and duration, inventories, spare capacity and alternative export outlets.',
    evidence: 'Confirm the affected facility, lost loadings, duration and usable alternatives with dated operator or official evidence.',
    measurementNote: 'No live lost-production or export-volume estimate is measured here.',
    sourceName: 'EIA · Oil prices and outlook',
    sourceUrl: 'https://www.eia.gov/energyexplained/oil-and-petroleum-products/prices-and-outlook.php',
    mechanismIds: ['supply', 'products'], origin: { x: 135, y: 188 }, separation: { x: -18, y: -28 },
  },
  {
    id: 'transport', title: 'Passage & freight', short: 'Routes, voyage time and delivery cost',
    explanation: 'Waiting and detours can extend voyages, use more fuel and occupy ships for longer. Higher delivered costs do not establish a loss of global oil production.',
    evidence: 'Check dated route restrictions, completed voyages, cargo volumes and comparable freight assessments. An AIS point alone cannot confirm a transit.',
    measurementNote: 'The diagram does not measure traffic, cargo flow or current route availability.',
    sourceName: 'EIA · World Oil Transit Chokepoints',
    sourceUrl: 'https://www.eia.gov/international/content/analysis/special_topics/World_Oil_Transit_Chokepoints/',
    mechanismIds: ['transport'], origin: { x: 285, y: 250 }, separation: { x: -6, y: 28 },
  },
  {
    id: 'risk', title: 'Security & insurance', short: 'Crew safety, cover and willingness to sail',
    explanation: 'Security exposure can change insurance terms and operators’ willingness to sail. Insurance costs may feed into freight rates without the same change in crude benchmarks.',
    evidence: 'Look for verified incidents, operator decisions and dated insurance or freight assessments. A reported attack alone does not quantify a premium.',
    measurementNote: 'No live war-risk insurance premium or freight assessment is measured here.',
    sourceName: 'EIA · Red Sea shipping costs (historical example)',
    sourceUrl: 'https://www.eia.gov/todayinenergy/detail.php?id=61363',
    mechanismIds: ['risk', 'people'], origin: { x: 435, y: 188 }, separation: { x: 6, y: -28 },
  },
  {
    id: 'benchmarks', title: 'Oil benchmarks', short: 'Observed prices in a global market',
    explanation: 'Brent and WTI reflect global supply, demand, inventories and expectations. Compare dated observations with evidence; a nearby headline does not isolate the cause of a price move.',
    evidence: 'Compare like-for-like dated prices and consider demand, inventories, production and other contemporaneous news before attributing a change.',
    measurementNote: 'Daily EIA spot observations are published with a lag. They are not an intraday quote or forecast.',
    sourceName: 'EIA · Oil prices and outlook',
    sourceUrl: 'https://www.eia.gov/energyexplained/oil-and-petroleum-products/prices-and-outlook.php',
    mechanismIds: ['buffers'], origin: { x: 585, y: 126 }, separation: { x: 18, y: -28 },
  },
].map(stage => Object.freeze({ ...stage, mechanismIds: Object.freeze(stage.mechanismIds), origin: Object.freeze(stage.origin), separation: Object.freeze(stage.separation) })));

export function normalizeStage(value) {
  return SYSTEM_STAGES.some(stage => stage.id === value) ? value : SYSTEM_STAGES[0].id;
}

function dayTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const at = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === value ? at : null;
}

function originalPublication(report) {
  if (typeof report?.publishedAt === 'string' && Number.isFinite(Date.parse(report.publishedAt))) {
    return { value: report.publishedAt, precision: report.publicationPrecision === 'day' ? 'day' : 'time' };
  }
  const value = report?.publishedDate || report?.publicationDate;
  return dayTime(value) !== null ? { value, precision: 'day' } : null;
}

function observedPrice(id, oil, oilFailed, now) {
  const definition = SOURCE_DEFINITIONS.find(item => item.id === id);
  const series = (Array.isArray(oil?.series) ? oil.series : []).find(item => item?.id === id);
  const byDate = new Map();
  for (const row of Array.isArray(series?.observations) ? series.observations : []) {
    const at = dayTime(row?.date);
    if (at !== null && at <= now && Number.isFinite(row.value)) byDate.set(row.date, { date: row.date, value: row.value, at });
  }
  const latest = [...byDate.values()].sort((a, b) => a.at - b.at).at(-1);
  const retrievalTime = typeof series?.retrievedAt === 'string' ? Date.parse(series.retrievedAt) : NaN;
  const retrievedAt = Number.isFinite(retrievalTime) && retrievalTime <= now ? series.retrievedAt : null;
  const failed = Boolean(oilFailed || series?.error || series?.localFailure || ['cached', 'unavailable', 'disconnected'].includes(series?.connection) || ['retained', 'unavailable'].includes(series?.status));
  const health = sourceHealth({ ...definition, ...series, retrievedAt, latest: latest?.date || null, recordCount: byDate.size }, now);
  const stale = Boolean(latest && (health.freshness === 'stale' || series?.freshness === 'stale' || series?.status === 'stale'));
  const loading = !oil || series?.connection === 'loading';
  const status = !latest ? failed ? 'unavailable' : loading ? 'loading' : 'empty'
    : failed ? 'retained' : stale ? 'stale' : !retrievedAt ? 'unknown' : 'available';
  return {
    id, name: id === 'brent' ? 'Brent' : 'WTI', value: latest?.value ?? null, date: latest?.date ?? null,
    unit: 'USD/barrel', basis: 'Daily spot', sourceName: definition.name, sourceUrl: definition.home,
    status, statusLabel: {
      loading: 'Checking daily prices', unavailable: 'Daily prices unavailable', empty: 'No daily observations',
      retained: 'Update failed · retained observation', stale: 'Older observation · check source dates',
      unknown: 'Retrieval time unknown', available: 'Daily observation · publication lag',
    }[status],
    failed, stale, retrievedAt, ageDays: latest ? Math.floor((now - latest.at) / DAY) : null,
    retrievalAgeSeconds: retrievedAt ? Math.floor((now - retrievalTime) / 1000) : null,
    error: typeof series?.error === 'string' ? series.error : oilFailed ? 'Price refresh failed; prior observations may be retained.' : null,
  };
}

/** A schematic interaction model, not a simulation of flows or a price forecast.
 * The view uses these exact positions, selected metadata and observed prices for
 * graphics, captions and accessibility text. Expansion changes only the layout.
 */
export function buildOilSystemState({ selected = 'supply', expanded = false, theater = 'both', report = null, oil = null, oilFailed = false, now = Date.now() } = {}) {
  const at = Number.isFinite(now) ? now : Date.now();
  const stageId = normalizeStage(selected);
  const separated = expanded === true;
  const scope = Object.hasOwn(names, theater) ? theater : 'both';
  const selectedReport = report && typeof report === 'object' && !Array.isArray(report) ? report : null;
  const mechanisms = selectedReport ? oilMechanisms(selectedReport) : [];
  const matchedStageIds = SYSTEM_STAGES.filter(stage => stage.mechanismIds.some(id => mechanisms.some(mechanism => mechanism.id === id))).map(stage => stage.id);
  const stages = SYSTEM_STAGES.map(stage => {
    const isSelected = stage.id === stageId;
    const offset = { x: separated ? stage.separation.x : 0, y: (separated ? stage.separation.y : 0) - (isSelected ? 10 : 0) };
    return { ...stage, selected: isSelected, matched: matchedStageIds.includes(stage.id), offset, position: { x: stage.origin.x + offset.x, y: stage.origin.y + offset.y } };
  });
  const activeStage = stages.find(stage => stage.selected);
  return {
    selected: stageId, expanded: separated, stages, activeStage, caption: activeStage.explanation,
    context: {
      theater: scope, title: names[scope], report: selectedReport, publication: originalPublication(selectedReport), mechanisms, matchedStageIds,
      label: !selectedReport ? 'No report selected · explore the system'
        : matchedStageIds.length ? 'Report wording suggests these channels; effects are not measured'
          : 'No oil channel identified in this report’s available text',
    },
    prices: ['brent', 'wti'].map(id => observedPrice(id, oil, oilFailed, at)),
    schematicNote: 'Illustrative system · not observed flows, current facility status or a navigable route. Layer movement explains structure only.',
    priceNote: 'A price move near a report does not establish causation. Daily observations may have different dates; no event-specific price effect is calculated.',
  };
}
