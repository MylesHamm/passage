import {collectorHealth} from './collector-status.mjs';
import {apiFetch,runtime,LIVE_REFRESH_MS} from './runtime-config.mjs';
import { EvidenceGraph, selectNeighborhood } from './graph-view.mjs';
import { normalizeManualReport, mergeManualEvidence, canonicalReportUrl } from './intelligence-data.mjs';
import { evidenceDate as dateFor, evidenceOrder as nodeOrder, filterEvidence, resolveFocus, GRAPH_TYPES } from './investigate-model.mjs';
import { reportingCoverageText } from './reporting-view.mjs';
import { SOURCE_DEFINITIONS, sourceHealth, statusSummary } from './source-health.mjs';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TYPES = { report: 'Report', actor: 'Actor', event: 'Event', asset: 'Infrastructure', market: 'Market', channel: 'Mechanism' };
const STORAGE_KEY = 'passage-intelligence-links';
const PAGE_SIZE = 30;
const DAY = 86400000;
const state = { base: null, graph: { nodes: [], edges: [], sources: [] }, selected: null, actor: null, query: '', type: 'all', days: '30', page: 0, expanded: false, view: 'network', error: null, loading: false, lastSuccess: null, initialFocusHandled: false, manual: [] };
const graphView = new EvidenceGraph($('#evidence-graph'), $('#graph-tooltip'), selectNode);
let pollTimer, toastTimer, searchTimer;

function formatDate(value, { short = false } = {}) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Not supplied';
  const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(value);
  const text = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', ...(short ? {} : { year: 'numeric' }), timeZone: 'UTC' }).format(date);
  if (dayOnly || short) return text;
  return `${text} · ${new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }).format(date)} UTC`;
}
function safeUrl(value) { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; } }
function originFor(node) { const record = node.record || {}; return record.source || record.publisher || record.provider || record.kind || TYPES[node.type] || 'Entity'; }
function sourceLink(url, label, className = '') { const safe = safeUrl(url); return safe ? `<a class="${className}" href="${esc(safe)}" target="_blank" rel="noopener noreferrer">${esc(label)} <span aria-hidden="true">↗</span></a>` : ''; }
function message(text) { clearTimeout(toastTimer); $('#toast').textContent = text; $('#toast').classList.add('visible'); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4500); }
function setMarkup(container, html) {
  if (container._markup === html) return;
  const focused = container.contains(document.activeElement) ? document.activeElement?.dataset?.selectNode : null;
  const scroll = container.scrollTop;
  container.innerHTML = html; container._markup = html; container.scrollTop = scroll;
  if (focused) [...container.querySelectorAll('[data-select-node]')].find(el => el.dataset.selectNode === focused)?.focus({ preventScroll: true });
}
function filteredEvidence() { return filterEvidence(state.graph, state); }
function handleInitialFocus() {
  if (state.initialFocusHandled) return;
  state.initialFocusHandled = true;
  const params = new URLSearchParams(location.search);
  const focus = params.get('focus'), actor = params.get('actor'), source = canonicalReportUrl(params.get('source'));
  const node = state.graph.nodes.find(item => item.id === focus || actor && item.id === `actor:${actor}` || source && canonicalReportUrl(item.sourceUrl || item.record?.url) === source);
  if (node) { state.selected = node.id; if (dateFor(node) && Date.parse(dateFor(node)) < Date.now() - 30 * DAY) { state.days = 'all'; $('#evidence-window').value = 'all'; } }
  else if (focus || actor || params.has('source')) message('That source or entity is not in the retrieved evidence. You can add an article using its original link.');
}
function render() {
  const filtered = filteredEvidence();
  state.selected = resolveFocus(filtered.network, state.selected, state.actor);
  const selected = filtered.network.nodes.find(node => node.id === state.selected);
  if (selected?.type === 'actor') state.actor = selected.id;
  renderActorControls(selected);
  renderLibrary(filtered.items, filtered.unknown);
  const neighborhood = selectNeighborhood(filtered.network, state.selected, { expanded: state.expanded, maxNodes: state.expanded ? 36 : 18 });
  graphView.update(neighborhood, state.selected);
  renderLegend(neighborhood);
  $('#network-scope').textContent = selected ? `Evidence paths around ${selected.label}` : !state.base && !state.error ? 'Loading source-linked records' : 'No matching evidence';
  $('#expand-network').disabled = !selected || !state.expanded && neighborhood.omitted === 0;
  $('#inspect-selection').disabled = !selected;
  $('#inspect-selection').textContent = selected ? `Read ${selected.type === 'report' ? 'report' : 'selected item'} details ↓` : 'Read source details ↓';
  $('#expand-network').textContent = state.expanded ? 'Compact network' : 'Show more evidence';
  $('#network-count').textContent = selected ? `${neighborhood.nodes.length} of ${neighborhood.connected} linked items shown. ${neighborhood.omitted ? 'More source records remain in the library. ' : ''}Short labels describe topics; hover or inspect for the full original wording.` : !state.base && !state.error ? 'Checking publisher feeds, official records and saved source links.' : 'Choose a broader date window or refresh the sources. Undated records are retained.';
  $('#graph-empty').hidden = neighborhood.nodes.length > 0;
  if (!neighborhood.nodes.length && !state.loading && (state.base || state.error)) setMarkup($('#graph-empty'), `<span class="empty-symbol" aria-hidden="true">⌁</span><strong>${state.base ? 'No evidence in this date window' : 'Evidence is not available yet'}</strong><p>${state.base ? 'Choose all dates or refresh the sources.' : 'Refresh to try again. Your saved sources stay in this browser.'}</p>`);
  renderInspector(selected, filtered.network);
  renderConnections(neighborhood);
  $('#export-evidence').disabled = !filtered.graph.nodes.length;
  $('#export-evidence').title = 'Download all filtered evidence and its direct relationship context, including source links. The graph display limit does not limit this export.';
  renderStatus();
}
function renderLegend(neighborhood) {
  const html = GRAPH_TYPES.map(([type, label]) => {
    const shown = neighborhood.visibleByType[type], linked = neighborhood.availableByType[type], total = neighborhood.totalByType[type];
    const status = linked ? `${shown} shown / ${linked} linked` : total ? 'No linked evidence in this window' : 'Not retrieved in this window';
    return `<button type="button" class="network-key-item ${linked ? '' : 'unavailable'}" data-graph-category="${type}" aria-pressed="${state.type === type}" ${total ? '' : 'disabled'} title="${esc(label)}: ${esc(status)}. Browse this type in the evidence library."><span><i class="key-${type}" aria-hidden="true"></i><strong>${label}</strong></span><small>${status}</small></button>`;
  }).join('');
  const focused = document.activeElement?.dataset.graphCategory;
  setMarkup($('#network-key'), html);
  if (focused) [...$('#network-key').querySelectorAll('[data-graph-category]')].find(button => button.dataset.graphCategory === focused)?.focus({ preventScroll: true });
}
function renderLibrary(items, unknown) {
  if (!state.base && !state.error && !items.length) { setMarkup($('#entity-list'), '<div class="loading-placeholder" aria-label="Loading evidence" aria-busy="true"><i></i><i></i><i></i><i></i><i></i></div>'); $('#library-count').textContent = '—'; $('#page-status').textContent = 'Loading…'; return; }
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE)); state.page = Math.min(state.page, pages - 1);
  $('#library-count').textContent = items.length.toLocaleString();
  $('#filter-summary').textContent = `${unknown ? `${unknown} undated ${unknown === 1 ? 'record remains' : 'records remain'} visible. ` : ''}Search and type filter this library. The network keeps your selected focus. Dates apply to both.`;
  const visible = items.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);
  const html = visible.length ? visible.map(node => {
    const date = dateFor(node), isRecord = ['report', 'event', 'market'].includes(node.type), saved = node.record?.manual || state.manual.some(record => record.url === node.sourceUrl);
    return `<button class="entity-row" data-select-node="${esc(node.id)}" aria-pressed="${node.id === state.selected}"><span class="row-meta"><span class="row-type">${esc(TYPES[node.type] || 'Entity')}</span>${isRecord ? `<span>· ${date ? esc(formatDate(date, { short: true })) : 'Publication unknown'}</span>` : ''}</span><strong>${esc(node.label)}</strong><span class="row-origin">${esc(originFor(node))}${saved ? ' · <span class="saved-label">Saved locally</span>' : ''}</span></button>`;
  }).join('') : '<div class="library-empty"><strong>No matching items.</strong>Try a broader search, choose another type or extend the date window. You can also add a source you found.</div>';
  setMarkup($('#entity-list'), html);
  $('#page-status').textContent = `Page ${state.page + 1} of ${pages}`;
  $('#previous-page').disabled = state.page === 0; $('#next-page').disabled = state.page >= pages - 1;
}
function renderActorControls(selected) {
  const actors = state.graph.nodes.filter(node => node.type === 'actor').sort((a, b) => a.label.localeCompare(b.label));
  const waiting = !state.base && !state.error;
  const options = `<option value="" disabled>${waiting ? 'Loading actors…' : 'Choose an actor…'}</option>` + actors.map(node => `<option value="${esc(node.id)}">${esc(node.label)}</option>`).join('');
  setMarkup($('#actor-select'), options);
  $('#actor-select').disabled = !actors.length;
  $('#actor-select').value = actors.some(node => node.id === state.actor) ? state.actor : '';
  const actor = actors.find(node => node.id === state.actor);
  const returnButton = $('#return-to-actor');
  returnButton.hidden = !actor || state.selected === state.actor;
  returnButton.textContent = actor ? `← Back to ${actor.label}` : 'Back to actor';
  $('#selection-status').textContent = selected ? `${TYPES[selected.type] || 'Item'} selected: ${selected.label}` : waiting ? 'Loading your starting point…' : 'No evidence available. Refresh to try again.';
}
function selectNode(id) {
  const node = state.graph.nodes.find(node => node.id === id);
  if (!node) return;
  const fromInspector = $('#inspector-body').contains(document.activeElement);
  state.selected = id; state.expanded = false;
  if (node.type === 'actor') state.actor = id;
  const url = new URL(location.href); url.searchParams.delete('source'); url.searchParams.delete('actor'); url.searchParams.set('focus', id);
  history.replaceState(null, '', url);
  render();
  $('#inspector-body').scrollTop = 0;
  if (fromInspector) $('#inspector-heading').focus({ preventScroll: true });
}
function fact(label, value) { return `<div><dt>${esc(label)}</dt><dd>${esc(value || 'Not supplied')}</dd></div>`; }
function renderInspector(node, graph) {
  if (!node) {
    setMarkup($('#inspector-body'), '<div class="inspector-empty"><span aria-hidden="true">◎</span><h3>No selection.</h3><p>Choose an item from the evidence library or adjust your filters. Source dates and relationship evidence appear here.</p></div>'); return;
  }
  const record = node.record || {}, url = node.sourceUrl || record.url;
  const edges = graph.edges.filter(edge => edge.from === node.id || edge.to === node.id);
  const nodeMap = new Map(graph.nodes.map(item => [item.id, item]));
  const local = state.manual.find(item => item.url === url);
  let facts = '';
  if (node.type === 'report') facts = fact('Publisher', originFor(node)) + (record.discoveryProvider ? fact('Discovered via', record.discoveryProvider) : '') + fact(record.publicationPrecision === 'day' || record.publishedDate && !record.publishedAt ? 'Publication date' : 'Published', formatDate(dateFor(node))) + (record.updatedAt ? fact('Publisher update', formatDate(record.updatedAt)) : '') + (record.discoveredAt || node.discoveredAt ? fact('Discovered', formatDate(record.discoveredAt || node.discoveredAt)) : '') + (record.addedAt ? fact('Saved locally', formatDate(record.addedAt)) : '') + (record.readAt ? fact('Context reviewed', formatDate(record.readAt)) : '') + (record.forecastCompleted ? fact('Forecast completed', formatDate(record.forecastCompleted)) : '') + (record.firstSeenAt ? fact('First retrieved locally', formatDate(record.firstSeenAt)) : '') + (record.lastSeenAt ? fact('Last seen in source', formatDate(record.lastSeenAt)) : '') + (record.retainedFromHistory ? fact('History', 'Retained; absent from current source snapshot') : '') + fact('Date basis', record.dateBasis || 'Publication date unknown');
  if (node.type === 'event') facts = fact('Source', originFor(node)) + fact('Event date', formatDate(node.eventDate)) + fact('Date precision', record.eventDatePrecision) + fact('Location text', record.locationText || 'Not supplied') + fact('Location basis', record.locationPrecision);
  if (node.type === 'market') facts = fact('Provider', record.provider) + fact('Observation', formatDate(record.observationDate)) + fact('Value', Number.isFinite(record.value) ? `${record.value.toFixed(2)} ${record.units || ''}` : 'Not supplied') + fact('Price basis', record.basis);
  if (!['report', 'event', 'market'].includes(node.type)) facts = fact('Entity type', record.kind || TYPES[node.type]) + fact('Connection basis', record.basis || 'See each source-linked relationship');
  const provenance = record.contentAccess || record.evidenceStatus || record.basis;
  const links = edges.slice().sort((a, b) => {
    const otherA = nodeMap.get(a.from === node.id ? a.to : a.from), otherB = nodeMap.get(b.from === node.id ? b.to : b.from);
    return nodeOrder(otherA, otherB);
  });
  const edgesHtml = links.map(edge => {
    const other = nodeMap.get(edge.from === node.id ? edge.to : edge.from); if (!other) return '';
    return `<li><button class="connection-target" data-select-node="${esc(other.id)}">${esc(other.label)} <span aria-hidden="true">↗</span></button><p class="edge-description"><strong>${esc(relationLabel(edge.relation))}</strong> · ${esc(edge.basis || 'Basis not supplied')}${edge.evidenceStatus ? `<br>${esc(edge.evidenceStatus)}` : ''}</p>${edge.matchedText ? `<span class="matched-text">Matched text: “${esc(edge.matchedText)}”</span>` : ''}${sourceLink(edge.sourceUrl, 'Relationship source', 'relation-source')}</li>`;
  }).join('');
  setMarkup($('#inspector-body'), `<p class="inspector-type">${esc(node.type==='report'&&record.type==='Independent energy analysis'?record.type:TYPES[node.type] || 'Entity')}</p><h3>${esc(node.label)}</h3>${record.summary ? `<p class="inspector-summary">${esc(record.summary)}</p>` : ''}${record.publisherSummary && record.publisherSummary !== record.summary ? `<div class="provenance-note"><strong>Publisher feed summary</strong>${esc(record.publisherSummary)}</div>` : ''}${record.reviewSummary && record.reviewSummary !== record.summary ? `<div class="provenance-note"><strong>Reviewed context</strong>${esc(record.reviewSummary)}</div>` : ''}${provenance ? `<div class="provenance-note"><strong>${esc(record.evidenceStatus || 'Source basis')}</strong>${esc(record.contentAccess || record.basis || '')}</div>` : ''}${sourceLink(url, 'Read original source', 'source-link')}<dl class="source-facts">${facts}</dl>${record.attributionNote ? `<p class="provenance-note">${esc(record.attributionNote)}${record.accessedVia ? `<br>${sourceLink(record.accessedVia, 'Read accessed version', 'relation-source')}` : ''}</p>` : ''}${record.watch ? `<div class="provenance-note"><strong>What still needs checking</strong>${esc(record.watch)}</div>` : ''}${record.reviewedContext ? `<div class="provenance-note"><strong>Reviewed context · ${esc(formatDate(record.reviewedContext.publishedDate))}</strong>${record.reviewedContext.title ? `${esc(record.reviewedContext.title)}<br>` : ''}${esc(record.reviewedContext.summary || '')}${record.reviewedContext.watch ? `<br>${esc(record.reviewedContext.watch)}` : ''}<br>Reviewed ${esc(formatDate(record.reviewedContext.readAt))}${record.reviewedContext.attributionNote ? `<br>${esc(record.reviewedContext.attributionNote)}` : ''}</div>` : ''}${record.analystNote ? `<div class="provenance-note"><strong>Your saved note · unverified</strong>${esc(record.analystNote)}</div>` : ''}<h4 class="inspector-section-title">${links.length} source-linked ${links.length === 1 ? 'connection' : 'connections'}</h4>${links.length ? `<ul class="inspector-connections">${edgesHtml}</ul>` : '<p class="microcopy">No rule-based text connections were found. This source remains available for review.</p>'}${local ? '<div class="inspector-actions"><button id="remove-manual-source" class="small-button remove-link">Remove saved source from this browser</button></div>' : ''}`);
}
function relationLabel(value) { return ({ MENTIONS: 'Mentions', POTENTIAL_CHANNEL: 'Potential oil channel', REPORTS_EVENT: 'Reports event', CONTEXT_FOR: 'Market context' })[value] || String(value || 'Related source').replaceAll('_', ' ').toLowerCase(); }
function renderConnections(neighborhood) {
  const nodes = new Map(neighborhood.nodes.map(node => [node.id, node]));
  const html = neighborhood.edges.map(edge => `<article><button data-select-node="${esc(edge.from)}">${esc(nodes.get(edge.from)?.label)}</button><br><span class="relation-pill">${esc(relationLabel(edge.relation))}</span><br><button data-select-node="${esc(edge.to)}">${esc(nodes.get(edge.to)?.label)}</button><p>${esc(edge.basis || 'Basis not supplied')}${edge.matchedText ? ` · Matched text: “${esc(edge.matchedText)}”` : ''}</p>${sourceLink(edge.sourceUrl, 'Open supporting source', 'relation-source')}</article>`).join('');
  setMarkup($('#connection-list'), html || '<div class="library-empty"><strong>No connections in this view.</strong>The selected record can still be inspected and opened in its original source.</div>');
}
function healthSources() {
  return (state.graph.sources || []).map(source => {
    const definition = SOURCE_DEFINITIONS.find(item => item.id === source.id) || {};
    return sourceHealth({ ...definition, ...source, configured: source.configured ?? true });
  });
}
function renderStatus() {
  $('#reporting-coverage').textContent = (runtime.configurationNotice||reportingCoverageText(state.graph.coverage,{hosted:runtime.hosted}));
  const sources = healthSources(), collector = runtime.hosted ? collectorHealth(state.graph.coverage?.collection) : null;
  let text;
  if (runtime.configurationError) text = 'Live data is not configured · your saved sources remain available';
  else if (state.loading && !state.base) text = 'Loading connected sources…';
  else if (state.error) text = `${state.base ? 'Update failed · previous evidence retained' : 'Sources could not be loaded'}${state.lastSuccess ? ` · last received ${formatDate(state.lastSuccess)}` : ''}`;
  else text = `${state.graph.nodes.filter(node => node.type === 'report').length} reports · ${collector?.attention ? collector.label : statusSummary(sources)}${state.loading ? ' · refreshing' : ''}`;
  setMarkup($('#load-status'), `<span class="status-dot ${state.error ? 'error' : state.base ? 'ready' : ''}" aria-hidden="true"></span>${esc(text)}`);
  $('#refresh-evidence').disabled = state.loading;
  $('#refresh-evidence').setAttribute('aria-busy', String(state.loading));
}
function renderCoverage() {
  const sources = healthSources();
  const limits = [...new Set([...(state.graph.limits || []), 'The network is a navigation tool. A text match is not independently verified evidence.', 'Saved articles and notes remain in this browser on this website address. Export them before changing browsers or clearing website data.'])];
  setMarkup($('#coverage-body'), `<p class="coverage-intro">${esc((runtime.configurationNotice||reportingCoverageText(state.graph.coverage,{hosted:runtime.hosted})))}</p><p class="coverage-intro">Evidence assembled ${formatDate(state.graph.generatedAt)}. Each source has its own publication, observation and retrieval clocks.${state.error ? ' The latest source refresh failed; source status below is retained from the previous response.' : ''}${state.graph.review?.date ? ` Manually reviewed context: ${formatDate(state.graph.review.date)}${state.graph.review.needsReview ? ' · review needed' : ''}.` : ''}</p>${sources.length ? sources.map(source => `<section class="coverage-source"><div><strong>${esc(source.name || source.id)}</strong><span>${esc(source.label)}</span></div><p>Last retrieved: ${esc(formatDate(source.retrievedAt))}${source.latest || source.latestRelevant ? `<br>Latest source observation: ${esc(formatDate(source.publicationPrecision === 'day' ? String(source.latestRelevant || source.latest).slice(0, 10) : source.latestRelevant || source.latest))}` : ''}${source.latestDiscoveredAt ? `<br>Latest discovery-index time: ${esc(formatDate(source.latestDiscoveredAt))} · publication time unknown` : ''}${Number.isInteger(source.recordCount) ? `<br>${source.recordCount} retrieved ${source.group === 'discovery' ? 'metadata ' : ''}${source.recordCount === 1 ? 'record' : 'records'}` : ''}${source.possiblyTruncated ? '<br>Source result limit reached; additional records may be omitted.' : ''}${source.nextRetryAt ? `<br>Next eligible source check: ${esc(formatDate(source.nextRetryAt))}` : ''}${source.error ? `<br>${esc(source.error)}` : ''}${source.limitations ? `<br>${esc(source.limitations)}` : ''}</p>${sourceLink(source.url || source.home, 'Source documentation', 'relation-source')}</section>`).join('') : '<p class="microcopy">No source health records have been received yet.</p>'}${state.graph.coverage?.attribution ? `<p class="coverage-intro">${sourceLink(state.graph.coverage.attribution.url, state.graph.coverage.attribution.label)}</p>` : ''}<h3 class="inspector-section-title">Interpretation limits</h3><ul class="coverage-limits">${limits.map(limit => `<li>${esc(limit)}</li>`).join('')}</ul>`);
}
function loadManualRecords() {
  try { const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); state.manual = Array.isArray(saved) ? saved.slice(0, 200) : []; }
  catch { state.manual = []; message('Saved source storage could not be read. Export existing research before clearing browser data.'); }
}
function persistManual(next) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); state.manual = next; return true; }
  catch { $('#save-source-status').textContent = 'This browser could not save the source. Free some website storage or use another browser; the source has not been saved.'; message('Browser storage is unavailable. The source was not saved.'); return false; }
}
function rebuild() {
  state.graph = mergeManualEvidence(state.base || { nodes: [], edges: [], sources: [], limits: [], schemaVersion: 'passage-evidence/v1' }, state.manual);
  render();
}
async function fetchEvidence() {
  if (state.loading) return;
  clearTimeout(pollTimer); state.loading = true; renderStatus();
  try {
    const response = await apiFetch('/api/intelligence', { signal: AbortSignal.timeout(60000), headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Source request returned ${response.status}`);
    const data = await response.json();
    if (data.schemaVersion !== 'passage-evidence/v1' || !Array.isArray(data.nodes) || !Array.isArray(data.edges) || !Array.isArray(data.sources)) throw new Error('Source response could not be interpreted');
    state.base = data; state.error = null; state.lastSuccess = new Date().toISOString();
    state.graph = mergeManualEvidence(data, state.manual); handleInitialFocus();
  } catch (error) { state.error = error.name === 'TimeoutError' ? 'Source request timed out' : 'Source request failed'; }
  finally {
    state.loading = false; render();
    if ($('#coverage-dialog').open) renderCoverage();
    const pending = healthSources().some(source => source.status === 'loading');
    pollTimer = setTimeout(() => { if (!document.hidden) fetchEvidence(); }, pending ? 30000 : LIVE_REFRESH_MS);
  }
}
function setView(view) {
  state.view = view; const network = view === 'network';
  $('#graph-stage').hidden = !network; $('#connection-list').hidden = network;
  $('#network-view').classList.toggle('active', network); $('#network-view').setAttribute('aria-pressed', String(network));
  $('#connections-view').classList.toggle('active', !network); $('#connections-view').setAttribute('aria-pressed', String(!network));
  if (network) graphView.fit();
}
function openAddDialog() { $('#save-source-status').textContent = ''; $('#add-source-dialog').showModal(); $('#article-url').focus(); }
function exportEvidence() {
  const filtered = filteredEvidence();
  const exported = { schemaVersion: state.graph.schemaVersion, generatedAt: state.graph.generatedAt, nodes: filtered.graph.nodes, edges: filtered.graph.edges, sources: state.graph.sources, coverage: state.graph.coverage, stats: { reports: filtered.graph.nodes.filter(node => node.type === 'report').length, events: filtered.graph.nodes.filter(node => node.type === 'event').length, entities: filtered.graph.nodes.filter(node => ['actor', 'asset'].includes(node.type)).length, connections: filtered.graph.edges.length }, limits: state.graph.limits, review: state.graph.review, exportInfo: { exportedAt: new Date().toISOString(), sourceGeneratedAt: state.base?.generatedAt || null, scope: 'All matching library records and their direct relationship context. Not limited by the displayed graph neighborhood.', filters: { query: state.query, type: state.type, days: state.days === 'all' ? null : Number(state.days) } } };
  const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = `passage-evidence-${new Date().toISOString().slice(0, 10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  message(`Exported ${exported.nodes.length} evidence items with source links and relationship details.`);
}

$('#entity-search').addEventListener('input', event => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.query = event.target.value.trim(); state.page = 0; state.expanded = false; render(); }, 150); });
for (const [selector, key] of [['#entity-type', 'type'], ['#evidence-window', 'days']]) $(selector).addEventListener('change', event => { state[key] = event.target.value; state.page = 0; state.expanded = false; render(); });
$('#previous-page').addEventListener('click', () => { state.page--; render(); $('#entity-list').scrollTop = 0; });
$('#next-page').addEventListener('click', () => { state.page++; render(); $('#entity-list').scrollTop = 0; });
document.addEventListener('click', event => {
  const select = event.target.closest('[data-select-node]'); if (select) selectNode(select.dataset.selectNode);
  const category = event.target.closest('[data-graph-category]');
  if (category && !category.disabled) { state.type = category.dataset.graphCategory; state.page = 0; $('#entity-type').value = state.type; render(); message(`${TYPES[state.type]} records selected in the evidence library. The network focus stays in place.`); }
  if (event.target.closest('[data-add-link]')) openAddDialog();
  if (event.target.closest('[data-close-dialog]')) event.target.closest('dialog').close();
  if (event.target.closest('#remove-manual-source')) {
    const node = state.graph.nodes.find(item => item.id === state.selected), url = node?.sourceUrl || node?.record?.url;
    if (persistManual(state.manual.filter(item => item.url !== url))) { rebuild(); message('Saved source removed from this browser. Connected publisher records are retained.'); }
  }
});
$('#refresh-evidence').addEventListener('click', fetchEvidence);
$('#show-coverage').addEventListener('click', () => { renderCoverage(); $('#coverage-dialog').showModal(); });
$('#expand-network').addEventListener('click', () => { state.expanded = !state.expanded; render(); });
$('#network-view').addEventListener('click', () => setView('network'));
$('#connections-view').addEventListener('click', () => setView('list'));
$('#zoom-in').addEventListener('click', () => graphView.changeZoom(1.25));
$('#zoom-out').addEventListener('click', () => graphView.changeZoom(.8));
$('#reset-view').addEventListener('click', () => graphView.fit());
$('#inspect-selection').addEventListener('click', () => { $('#inspector-heading').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); $('#inspector-heading').focus({ preventScroll: true }); });
$('#export-evidence').addEventListener('click', exportEvidence);
$('#actor-select').addEventListener('change', event => {
  if (event.target.value) selectNode(event.target.value);
});
$('#return-to-actor').addEventListener('click', () => selectNode(state.actor));
$('#add-source-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const record = normalizeManualReport({ url: $('#article-url').value, title: $('#article-title').value, publisher: $('#article-publisher').value, publishedDate: $('#article-published').value || null, note: $('#article-note').value });
    const next = state.manual.filter(item => item.url !== record.url);
    if (next.length >= 200) { $('#save-source-status').textContent = 'This browser has reached its 200-source limit. Export your evidence, then remove an older saved source before adding another.'; return; }
    if (!persistManual([record, ...next])) return;
    state.query = ''; state.type = 'all'; state.days = 'all'; state.page = 0; state.selected = `report:${record.url}`;
    $('#entity-search').value = ''; $('#entity-type').value = 'all'; $('#evidence-window').value = 'all';
    rebuild(); $('#add-source-dialog').close(); $('#add-source-form').reset(); message('Source saved in this browser. Its connections are based on your supplied headline and note.');
  } catch (error) { $('#save-source-status').textContent = error.message || 'The source could not be saved. Check its URL and publication date.'; }
});
$('#article-published').max = new Date().toISOString().slice(0, 10);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !state.loading && (!state.lastSuccess || Date.now() - Date.parse(state.lastSuccess) > LIVE_REFRESH_MS)) fetchEvidence(); });
loadManualRecords(); rebuild(); fetchEvidence();
