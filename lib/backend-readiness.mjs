import {SOURCE_CAPABILITIES,RETIRED_SOURCE_IDS} from '../dist/source-policy.mjs';
import {publisherDateMillis} from './feeds.mjs';

const ADVISORY_ID='marad-advisories';
const DISCOVERY_IDS=SOURCE_CAPABILITIES.discovery.sourceIds;
const timestamp=value=>typeof value==='string'&&value.trim()?publisherDateMillis(value):NaN;
const sameIds=(actual,expected)=>Array.isArray(actual)&&actual.length===expected.length&&new Set(actual).size===actual.length&&expected.every(id=>actual.includes(id));
const count=value=>Number.isInteger(value)&&value>=0;

// Compatibility, established evidence and current provider health are different
// checks. Use the existing public contract, not a commit/version string or a
// newly required backend field. An aligned deployment may still have outages.
export function assessBackendReadiness({config,diagnostics,news,maritime,now=Date.now()}={}){
  const capabilityFailures=[],coverageFailures=[],warnings=[];
  const fail=(id,name,reason)=>capabilityFailures.push({id,name,category:'capability',reasons:[reason]});
  for(const [endpoint,payload] of [['config',config],['news',news]]){
    for(const [name,expected] of Object.entries(SOURCE_CAPABILITIES)){
      const capability=payload?.capabilities?.[name];
      if(!capability||capability.core!==expected.core||!sameIds(capability.sourceIds,expected.sourceIds)){
        fail(`${endpoint}:${name}`,`${endpoint} ${name} capability`,'Required source IDs or core/supporting semantics do not match this frontend.');
      }
    }
  }
  function sourcesFor(endpoint,payload){
    if(!Array.isArray(payload?.sources)){fail(endpoint,`${endpoint} source schema`,'Source status array is missing.');return [];}
    const ids=payload.sources.map(source=>source?.id);
    if(ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length)fail(endpoint,`${endpoint} source schema`,'Source IDs must be present and unique.');
    return payload.sources.filter(source=>source&&typeof source==='object'&&typeof source.id==='string');
  }
  const diagnosticSources=sourcesFor('diagnostics',diagnostics),newsSources=sourcesFor('news',news),maritimeSources=sourcesFor('maritime',maritime);
  for(const [endpoint,sources] of [['diagnostics',diagnosticSources],['news',newsSources]]){
    for(const id of RETIRED_SOURCE_IDS){
      const source=sources.find(source=>source.id===id);
      if(!source||source.configured!==false||source.retired!==true)fail(id,`${endpoint} ${id}`,'Retired collector must be explicitly disabled; archived evidence may remain.');
    }
    const discovery=sources.filter(source=>source.id.startsWith('gdelt-')&&source.configured!==false);
    if(!sameIds(discovery.map(source=>source.id),DISCOVERY_IDS)||discovery.some(source=>source.configured!==true)){
      fail('discovery',`${endpoint} discovery configuration`,'Exactly the Hormuz and Red Sea GDELT families must be configured.');
    }
    for(const source of discovery){
      if(source.interval!==1800)fail(source.id,`${endpoint} ${source.id}`,'Maritime discovery must use the reviewed 30-minute polling interval.');
    }
  }
  if(news?.coverage?.discoveryFamilies!==DISCOVERY_IDS.length||!sameIds(news?.coverage?.retiredSources,RETIRED_SOURCE_IDS)||news?.coverage?.reuters?.mode!=='retained-links-only'){
    fail('news-coverage','Reporting coverage schema','Discovery/retirement coverage does not match the configured collectors.');
  }
  for(const [endpoint,sources] of [['diagnostics',diagnosticSources],['maritime',maritimeSources]]){
    const source=sources.find(source=>source.id===ADVISORY_ID);
    if(!source||source.configured!==true||source.capability!=='supporting')fail(ADVISORY_ID,`${endpoint} MARAD adapter`,'The configured supporting MARAD advisory adapter is missing or incompatible.');
  }
  const advisories=Array.isArray(maritime?.advisories)?maritime.advisories:null;
  const coverage=maritime?.coverage?.advisories;
  if(!advisories||!Array.isArray(maritime?.events)||maritime?.coverage?.complete!==false||coverage?.incidentCoverage!==false){
    fail('advisory-schema','Maritime advisory schema','Separate advisory records and explicitly incomplete, non-incident coverage are required.');
  }
  if(advisories?.some(record=>!record||record.sourceId!==ADVISORY_ID||record.recordKind!=='official-advisory'||record.recordType!=='advisory'||record.eventDate!==null||record.publishedDate!==null||!['active','cancelled'].includes(record.sourceStatus)||!['active','cancelled','superseded','expired','not-yet-effective','unknown'].includes(record.validityState))){
    fail('advisory-records','MARAD evidence semantics','Advisories must retain validity/source status without inventing incident or publication dates.');
  }
  if(Array.isArray(maritime?.events)&&maritime.events.some(record=>record?.sourceId===ADVISORY_ID||record?.recordType==='advisory'))fail('advisory-events','MARAD evidence semantics','Advisory records cannot be included as incidents or statements.');
  if(advisories?.length&&(coverage?.recordKind!=='official-advisory'||coverage?.cancelledArchiveComplete!==false||coverage?.publicationDateKnown!==false||!count(coverage?.activeListedCount)||!count(coverage?.cancelledListedCount)||coverage.activeListedCount!==advisories.filter(record=>record?.sourceStatus==='active').length||coverage.cancelledListedCount!==advisories.filter(record=>record?.sourceStatus==='cancelled').length)){
    fail('advisory-coverage','MARAD coverage semantics','Listed active/cancelled counts and incomplete history/unknown publication semantics must agree with retained records.');
  }
  const advisorySource=maritimeSources.find(source=>source.id===ADVISORY_ID),retrieved=timestamp(advisorySource?.retrievedAt);
  // The adapter rejects ambiguous empty indexes. A first failed request is not
  // established coverage. A retained validated snapshot remains established,
  // but is not current or healthy merely because the adapter is deployed.
  const established=!!advisories?.length&&advisorySource?.recordCount===advisories.length&&Number.isFinite(retrieved)&&retrieved<=now+60000;
  if(!established)coverageFailures.push({id:ADVISORY_ID,name:'MARAD advisory coverage',category:'coverage',reasons:['No previously validated advisory snapshot with its successful retrieval clock is established. An empty/missing response is not an all-clear.']});
  for(const id of [ADVISORY_ID,...DISCOVERY_IDS]){
    const source=(id===ADVISORY_ID?maritimeSources:newsSources).find(source=>source.id===id);
    if(!source||source.configured!==true)continue;
    const reasons=[],retrievedAt=timestamp(source.retrievedAt),maxAge=id===ADVISORY_ID?86400000:7200000;
    if(source.connection!=='connected'||source.error||source.errorCategory||source.httpStatus>=400)reasons.push('Latest provider update has not succeeded; current coverage is incomplete.');
    if(!Number.isFinite(retrievedAt)||retrievedAt>now+60000)reasons.push('Successful retrieval clock is missing or invalid.');
    else if(now-retrievedAt>=maxAge)reasons.push('Successful retrieval is overdue; retained evidence keeps its original dates.');
    if(source.cacheIssue)reasons.push('Retrieved metadata could not be persisted reliably.');
    if(reasons.length)warnings.push({id,name:source.name||id,category:'source-health',reasons,connection:source.connection,status:source.status,retrievedAt:source.retrievedAt??null,checkedAt:source.checkedAt??null,nextRetryAt:source.nextRetryAt??null,errorCategory:source.errorCategory??null,httpStatus:source.httpStatus??null});
  }
  const failures=[...capabilityFailures,...coverageFailures];
  return {ready:failures.length===0,compatible:capabilityFailures.length===0,coverageEstablished:established,capabilityFailures,coverageFailures,failures,warnings};
}
