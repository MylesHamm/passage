import {collectorHealth} from './collector-status.mjs';
import {isActiveReportingSource} from './source-health.mjs';
// Browser-safe reporting policy: relevance is distinct from geographic location.
export const reportTime = item => item.publicationPrecision==='day' ? item.publishedDate||item.publicationDate||item.publishedAt?.slice(0,10)||null : item.publishedAt||item.publishedDate||item.discoveredAt||null;
export const reportTimeLabel = item => item.publicationPrecision==='day'||item.publishedDate ? 'Publication date' : item.publishedAt ? 'Published' : item.discoveredAt ? 'Discovered · publication unknown' : 'Publication date unknown';
export const reportRelevant = item => !!(item.theaters?.length||item.relevanceScopes?.some(x=>['regional-energy','global-energy'].includes(x)));
export const matchesTheater = (item,theater) => theater==='both'||item.theaters?.includes(theater)||item.relevanceScopes?.some(x=>['regional-energy','global-energy'].includes(x));
export function inReportingWindow(item,hours,now=Date.now()) {
  const timestamp=reportTime(item);if(!timestamp)return true; // Unknown dates remain explicitly labeled.
  const ms=Date.parse(timestamp);return Number.isFinite(ms)&&ms<=now+300000&&(hours==='all'||ms>=now-Number(hours)*3600000);
}
export function sortReports(a,b){return (reportTime(b)||'').localeCompare(reportTime(a)||'')||a.title.localeCompare(b.title);}

// These are broad monitoring topics, not locations established by the record.
export const reportContextLabel = theater => ({hormuz:'Iran & Gulf context',bab:'Yemen & Red Sea context'})[theater]||'Regional context';

export function isActivePublisherReport(item,sources=[]) {
  return !item.retainedFromHistory&&!item.collectionRetired&&!item.retainedForReading&&isActiveReportingSource(sources.find(source=>source.id===item.sourceId))&&item.dateBasis!=='discovery'&&item.type!=='Discovered reporting'&&!item.discoveryProvider&&item.contentAccess!=='discovery-metadata';
}

// Keep the difference between indexed links and a direct publisher feed visible.
export function reportingCoverageText(coverage,{hosted=false,now=Date.now()}={}) {
  if (!coverage) return 'Checking reporting coverage…';
  const parts = ['The default view uses working publisher feeds. Include the historical archive to read previously collected links, including retired sources. Historical records keep their original publication and retrieval dates.'];
  if(coverage.publicationUnknown)parts.push(`${coverage.publicationUnknown} links have unknown publication dates; discovery time is not publication time.`);
  if(coverage.possiblyTruncatedFamilies?.length)parts.push('Discovery results are bounded and may omit relevant links.');
  if(hosted)parts.push(collectorHealth(coverage.collection,now).notice);
  const archive = coverage.archive;
  if (archive) {
    parts.push(`Local history: ${archive.recordCount} reports; up to ${archive.retentionDays} days since last retrieval, limited to ${archive.maxRecords.toLocaleString()} records.`);
    if(archive.retainedCount)parts.push(`${archive.retainedCount} links are retained from earlier retrievals.`);
    if (archive.truncated) parts.push('Some older records were dropped at the storage limit.');
    if (archive.storageStatus !== 'ready') parts.push(archive.error || 'History could not be saved to disk.');
  }
  if (coverage.omittedReports) parts.push(`${coverage.omittedReports} reports exceed this network’s limit.`);
  return parts.join(' ');
}
