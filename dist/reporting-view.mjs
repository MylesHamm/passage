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
export function reportingCoverageText(coverage,{hosted=false,failed=false,now=Date.now()}={}) {
  if (!coverage) return failed?'Reporting coverage is unavailable. Inspect Coverage & sources for the failed connection.':'Checking reporting coverage…';
  const parts = ['The default view uses working publisher feeds. Include the historical archive to read previously collected links, including retired sources. Historical records keep their original publication and retrieval dates.'];
  if(failed)parts.unshift('The reporting update failed. Coverage details below describe the last retrieved snapshot.');
  if(coverage.publicationUnknown)parts.push(`${coverage.publicationUnknown} links have unknown publication dates; discovery time is not publication time.`);
  if(coverage.possiblyTruncatedFamilies?.length)parts.push('Discovery results are bounded and may omit relevant links.');
  if(hosted)parts.push(collectorHealth(coverage.collection,now).notice);
  const archive = coverage.archive;
  if (archive) {
    const countKnown=Number.isInteger(archive.recordCount)&&archive.recordCount>=0;
    const durationKnown=Number.isFinite(archive.retentionDays)&&archive.retentionDays>0;
    const capacityKnown=Number.isInteger(archive.maxRecords)&&archive.maxRecords>0;
    const limits=[];
    if(durationKnown)limits.push(`up to ${archive.retentionDays} days since last retrieval`);
    if(capacityKnown)limits.push(`limited to ${archive.maxRecords.toLocaleString()} records`);
    parts.push(`Local history: ${countKnown?`${archive.recordCount} reports`:'record count unavailable'}${limits.length?`; ${limits.join(', ')}`:''}.`);
    if(!durationKnown||!capacityKnown)parts.push('Some history retention limits are unavailable.');
    if(Number.isInteger(archive.retainedCount)&&archive.retainedCount>0)parts.push(`${archive.retainedCount} links are retained from earlier retrievals.`);
    if (archive.truncated===true) parts.push('Some older records were dropped at the storage limit.');
    if (archive.error) parts.push(archive.error);
    else if (archive.storageStatus==='memory-only') parts.push('History could not be saved to disk.');
    else if (archive.storageStatus!=='ready') parts.push('History storage status is unavailable.');
  }
  if (coverage.omittedReports) parts.push(`${coverage.omittedReports} reports exceed this network’s limit.`);
  return parts.join(' ');
}

export function reportingEmptyState({saved=false,unconfigured=false,configurationNotice='',unknown=false,pending=false,incomplete=false,hasArchive=false}={}) {
  if(saved)return {heading:'No saved reports match this view.',detail:'Saved reports remain on this browser.',reset:true};
  if(unconfigured)return {heading:'Reporting is not configured.',detail:configurationNotice,reset:false};
  if(unknown&&pending)return {heading:'Checking reporting sources.',detail:'Waiting for publisher responses. Coverage is not yet established.',reset:false};
  if(unknown)return {heading:'Reporting is unavailable.',detail:'Current publisher reporting is unavailable. Coverage & sources has details.'+(hasArchive?' Previously retrieved links remain in the historical archive.':''),reset:false};
  return {heading:'No current reports match these filters.',detail:incomplete?'Try a wider date window or include the historical archive. No matching reports do not establish that no events occurred.':'Try a wider reporting window or reset the filters. Retrieved reports are not a complete account of events.',reset:true};
}
