import { reportClock } from './intelligence-data.mjs';

const DAY = 86400000;
const datedRecord = node => ['report', 'event'].includes(node.type);
export const GRAPH_TYPES = [
  ['report', 'Report'], ['actor', 'Actor'], ['asset', 'Infrastructure'],
  ['market', 'Market'], ['channel', 'Mechanism'], ['event', 'Event'],
];

/** Topic summaries are navigation labels, never rewritten claims about an event. */
export function summarizeGraphNode(node, graph = { nodes: [], edges: [] }) {
  const record = node.record || {}, fullTitle = String(node.label || 'Untitled source');
  const source = record.source || record.publisher || record.provider || '';
  const date = evidenceDate(node);
  if (node.type === 'market') {
    const name = record.seriesId === 'brent' ? 'Brent' : record.seriesId === 'wti' ? 'WTI' : fullTitle;
    return { title: `${name}${Number.isFinite(record.value) ? ` · $${record.value.toFixed(2)}` : ''}`, detail: `${source || 'EIA'} daily spot${date ? ' · ' + date : ''}`, qualification: 'Shared context · no causal attribution', fullTitle };
  }
  if (node.type === 'channel') return { title: fullTitle, detail: 'Potential channel · effect not measured', qualification: '', fullTitle };
  if (!datedRecord(node)) return { title: fullTitle, detail: node.type === 'asset' ? 'Reference infrastructure' : 'Mentioned actor or group', qualification: '', fullTitle };
  const protectedWords = /\b(?:den(?:y|ies|ied|ial)|not|no|never|without|false|untrue|disput(?:e|es|ed)|may|might|could|possible|possibly|alleged|unconfirmed|reportedly|potential|forecast|expects?|expected|plans?|hopes?|fears?|likely|unlikely|report(?:s|ed)?|believes?|says?|said|claims?|according|warns?|warned|confirms?|confirmed)\b/ig;
  const cues = [...fullTitle.matchAll(protectedWords)].map(match => match[0].toLocaleLowerCase());
  const preservesCues = text => cues.every(cue => new RegExp('\\b' + cue + '\\b', 'i').test(text));
  let qualification = record.manual ? 'User-supplied · unverified' : node.type === 'event' ? 'Structured source record' : '';
  let title = fullTitle;
  // Keep the entire compact headline: a later clause can retract, qualify or
  // attribute an earlier one. Longer records receive an explicitly topical label.
  if (fullTitle.length > 54) {
    const compact = fullTitle.replace(/^(?:Watch|Video|Photos):\s*/i, '').replace(/\bStrait of Hormuz\b/g, 'Hormuz').replace(/\bUnited States\b/g, 'U.S.');
    title = compact.length <= 80 && preservesCues(compact) ? compact : '';
  }
  if (!title) {
    const nodeMap = new Map((graph.nodes || []).map(item => [item.id, item]));
    const mentions = (graph.edges || []).filter(edge => edge.from === node.id && edge.relation === 'MENTIONS')
      .map(edge => ({ node: nodeMap.get(edge.to), index: edge.matchedText ? fullTitle.toLocaleLowerCase().indexOf(edge.matchedText.toLocaleLowerCase()) : -1 }))
      .filter(item => item.node).sort((a, b) => (a.index < 0 ? Infinity : a.index) - (b.index < 0 ? Infinity : b.index) || a.node.label.localeCompare(b.node.label));
    const actors = mentions.filter(item => item.node.type === 'actor');
    const actor = actors.find(item => !['actor:merchant-shipping', 'actor:civilians'].includes(item.node.id))?.node || actors[0]?.node;
    const asset = mentions.find(item => item.node.type === 'asset')?.node;
    const topics = [
      [/\bpipeline|petroline\b/i, 'Pipeline operations'], [/\brefin|diesel|gasoil|gasoline|jet fuel\b/i, 'Fuel & refining'],
      [/\bsanction|diploma|negotiat|ceasefire|talks|agreement\b/i, 'Diplomacy & restrictions'],
      [/\bexports?\b/i, 'Oil exports'], [/\bproduction|output|supply\b/i, 'Oil supply'], [/\bship|vessel|tanker|transit|strait|rerout|freight\b/i, 'Shipping & transit'],
      [/\battack|strike|missile|drone|seiz|explos\b/i, 'Security reporting'], [/\binventor|stocks|demand\b/i, 'Stocks & demand'],
      [/\bprice|brent|wti|crude|oil\b/i, 'Oil-market reporting'],
    ];
    const topic = topics.find(([pattern]) => pattern.test(fullTitle))?.[1] || (node.type === 'event' ? 'Recorded event' : 'Source reporting');
    title = 'Topic: ' + [actor?.label, asset?.label, topic].filter(Boolean).join(' · ');
    if (!qualification && cues.length) qualification = 'Headline wording: ' + [...new Set(cues)].map(cue => '“' + cue + '”').join(', ');
  }
  return { title, detail: [source || (node.type === 'event' ? 'Source event' : 'Report'), record.type === 'Independent energy analysis' ? 'Independent energy analysis' : '', date?.slice(0, 10) || 'Date unknown'].filter(Boolean).join(' · '), qualification, fullTitle };
}

/** Keep the actual evidence paths; category balance is a display choice, not a ranking. */
export function selectNeighborhood(graph, selectedId, { expanded = false, maxNodes = expanded ? 36 : 18 } = {}) {
  const nodes = new Map((graph.nodes || []).map(node => [node.id, node]));
  const edges = (graph.edges || []).filter(edge => nodes.has(edge.from) && nodes.has(edge.to));
  const totalByType = Object.fromEntries(GRAPH_TYPES.map(([type]) => [type, [...nodes.values()].filter(node => node.type === type).length]));
  const emptyCounts = () => Object.fromEntries(GRAPH_TYPES.map(([type]) => [type, 0]));
  const selected = nodes.get(selectedId);
  if (!selected) return { nodes: [], edges: [], hidden: nodes.size, connected: 0, omitted: 0, outside: nodes.size, repeatedHeadlines: 0, totalByType, availableByType: emptyCounts(), visibleByType: emptyCounts() };
  const adjacency = new Map([...nodes.keys()].map(id => [id, []]));
  for (const edge of edges) {
    adjacency.get(edge.from).push({ id: edge.to, edge });
    adjacency.get(edge.to).push({ id: edge.from, edge });
  }
  const order = (a, b) => evidenceOrder(nodes.get(a), nodes.get(b));
  const paths = new Map([[selectedId, [[selectedId]]]]);
  const addPath = path => {
    if (new Set(path).size !== path.length) return;
    const id = path.at(-1), saved = paths.get(id) || [];
    if (!saved.some(previous => previous.join('\n') === path.join('\n'))) saved.push(path);
    paths.set(id, saved);
  };
  const addMarkets = path => {
    const id = path.at(-1);
    if (nodes.get(id).type !== 'channel') return;
    for (const next of adjacency.get(id)) if (next.edge.from === id && next.edge.relation === 'CONTEXT_FOR' && nodes.get(next.id).type === 'market') addPath([...path, next.id]);
  };
  for (const direct of adjacency.get(selectedId)) {
    const path = [selectedId, direct.id]; addPath(path); addMarkets(path);
    // Follow the selected actor/asset/mechanism's own evidence records only.
    // A shared actor, mechanism or register is never a route into unrelated reporting.
    if (!datedRecord(selected) && datedRecord(nodes.get(direct.id))) {
      for (const next of adjacency.get(direct.id)) {
        if (next.id === selectedId) continue;
        const contextPath = [...path, next.id]; addPath(contextPath); addMarkets(contextPath);
      }
    }
  }
  const availableByType = emptyCounts();
  for (const id of paths.keys()) availableByType[nodes.get(id).type] = (availableByType[nodes.get(id).type] || 0) + 1;
  const limit = Math.max(1, Math.min(80, Math.floor(Number(maxNodes)) || 1));
  const caps = expanded ? { actor: 5, asset: 4, market: 2, channel: 5, event: 4, report: 10 } : { actor: 2, asset: 1, market: 2, channel: 2, event: 1, report: 3 };
  const visible = new Set([selectedId]);
  const headline = id => String(nodes.get(id).label || '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
  const count = type => [...visible].filter(id => nodes.get(id).type === type).length;
  const missing = path => path.filter(id => !visible.has(id));
  const breadth = path => new Set(path.filter(id => datedRecord(nodes.get(id))).flatMap(id => adjacency.get(id).map(next => nodes.get(next.id).type))).size;
  const bestPath = id => paths.get(id).slice().sort((a, b) => missing(a).length - missing(b).length || breadth(b) - breadth(a) || order(a[1] || a[0], b[1] || b[0]) || a.join('\n').localeCompare(b.join('\n')))[0];
  // Reserve room for a path to each available category before adding extra reports.
  const categories = ['asset', 'channel', 'market', 'event', 'actor', 'report'];
  let changed = true;
  while (changed && visible.size < limit) {
    changed = false;
    for (const type of categories) {
      if (count(type) >= caps[type]) continue;
      const candidates = [...paths.keys()].filter(id => !visible.has(id) && nodes.get(id).type === type)
        .filter(id => expanded || type !== 'report' || ![...visible].some(shown => nodes.get(shown).type === 'report' && headline(shown) === headline(id)))
        .map(id => ({ id, path: bestPath(id) }))
        .filter(item => visible.size + missing(item.path).length <= limit)
        .sort((a, b) => missing(a.path).length - missing(b.path).length || breadth(b.path) - breadth(a.path) || order(a.id, b.id));
      if (!candidates.length) continue;
      for (const id of candidates[0].path) visible.add(id);
      changed = true;
    }
  }
  const visibleByType = emptyCounts();
  for (const id of visible) visibleByType[nodes.get(id).type] = (visibleByType[nodes.get(id).type] || 0) + 1;
  const shownHeadlines = new Set([...visible].filter(id => nodes.get(id).type === 'report').map(headline));
  const repeatedHeadlines = expanded ? 0 : [...paths.keys()].filter(id => !visible.has(id) && nodes.get(id).type === 'report' && shownHeadlines.has(headline(id))).length;
  return {
    nodes: [...visible].map(id => nodes.get(id)), edges: edges.filter(edge => visible.has(edge.from) && visible.has(edge.to)),
    hidden: nodes.size - visible.size, connected: paths.size, omitted: paths.size - visible.size, outside: nodes.size - paths.size,
    repeatedHeadlines, totalByType, availableByType, visibleByType,
  };
}

export function evidenceDate(node) {
  const record = node.record || {};
  // Discovery and retrieval clocks cannot stand in for an unknown publication.
  return node.type === 'report'
    ? (record.publishedAt || record.publishedDate ? reportClock(record).value : null)
    : node.eventDate || record.observationDate || null;
}

export function evidenceOrder(a, b) {
  const aRecord = datedRecord(a), bRecord = datedRecord(b);
  if (aRecord !== bRecord) return aRecord ? -1 : 1;
  return String(evidenceDate(b) || '').localeCompare(String(evidenceDate(a) || ''))
    || a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
}

/** A disappearing report returns to the actor being explored, not another country. */
export function resolveFocus(network, selectedId, actorId) {
  const ids = new Set(network.nodes.map(node => node.id));
  return [selectedId, actorId, 'actor:saudi-arabia'].find(id => ids.has(id))
    || network.nodes.find(node => node.type === 'report')?.id || network.nodes[0]?.id || null;
}

/** Library filters narrow results and exports without trapping network navigation. */
export function filterEvidence(graph, { query = '', type = 'all', days = '30', now = Date.now() } = {}) {
  const earliest = days === 'all' ? -Infinity : Date.parse(new Date(now).toISOString().slice(0, 10)) - (Number(days) - 1) * DAY;
  const eligible = graph.nodes.filter(node => !datedRecord(node) || !evidenceDate(node) || Date.parse(evidenceDate(node)) >= earliest);
  const eligibleIds = new Set(eligible.map(node => node.id));
  const edges = graph.edges.filter(edge => eligibleIds.has(edge.from) && eligibleIds.has(edge.to));
  const search = query.toLocaleLowerCase();
  const items = eligible.filter(node => (type === 'all' || node.type === type) && (!search || [node.label, node.record?.summary, node.record?.source, node.record?.publisher, node.record?.analystNote, node.record?.watch].filter(Boolean).join(' ').toLocaleLowerCase().includes(search))).sort(evidenceOrder);

  // Export each matching item with its direct relationship context. Do not
  // recursively add unrelated records through a shared actor or mechanism.
  const scope = new Set(items.map(node => node.id));
  const matching = new Set(scope);
  for (const edge of edges) if (matching.has(edge.from) || matching.has(edge.to)) { scope.add(edge.from); scope.add(edge.to); }

  return {
    items,
    graph: { nodes: eligible.filter(node => scope.has(node.id)), edges: edges.filter(edge => scope.has(edge.from) && scope.has(edge.to)) },
    network: { nodes: eligible, edges },
    unknown: items.filter(node => datedRecord(node) && !evidenceDate(node)).length,
  };
}
