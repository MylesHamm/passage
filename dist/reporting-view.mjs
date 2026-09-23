import {collectorHealth} from './collector-status.mjs';
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

// Keep the difference between indexed links and a direct publisher feed visible.
export function reportingCoverageText(coverage,{hosted=false,now=Date.now()}={}) {
  if (!coverage) return 'Checking reporting coverage…';
  const parts = ['Reuters: public discovery. Direct Reuters delivery and your Reuters topic preferences are not connected.'];
  if(hosted)parts.push(collectorHealth(coverage.collection,now).notice);
  const archive = coverage.archive;
  if (archive) {
    parts.push(`Local history: ${archive.recordCount} reports; up to ${archive.retentionDays} days since last retrieval, limited to ${archive.maxRecords.toLocaleString()} records.`);
    if (archive.truncated) parts.push('Some older records were dropped at the storage limit.');
    if (archive.storageStatus !== 'ready') parts.push(archive.error || 'History could not be saved to disk.');
  }
  if (coverage.omittedReports) parts.push(`${coverage.omittedReports} reports exceed this network’s limit.`);
  return parts.join(' ');
}
