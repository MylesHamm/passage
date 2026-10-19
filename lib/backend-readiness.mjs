import {SOURCE_CAPABILITIES,RETIRED_SOURCE_IDS,RETIRED_REPORTING_SOURCE_IDS} from '../dist/source-policy.mjs';
import {publisherDateMillis} from './feeds.mjs';

const ADVISORY_ID='marad-advisories';
const DISCOVERY_IDS=SOURCE_CAPABILITIES.discovery.sourceIds;
const timestamp=value=>typeof value==='string'&&value.trim()?publisherDateMillis(value):NaN;
const sameIds=(actual,expected)=>Array.isArray(actual)&&actual.length===expected.length&&new Set(actual).size===actual.length&&expected.every(id=>actual.includes(id));
const count=value=>Number.isInteger(value)&&value>=0;

// Compatibility, established evidence and current provider health are different
// checks. Intentional retirement must expose unavailable coverage, even when
// archived evidence exists. Passing this gate never establishes total coverage.
export function assessBackendReadiness({config,diagnostics,news,maritime,now=Date.now()}={}){
  const capabilityFailures=[],coverageFailures=[],warnings=[];
  const fail=(id,name,reason)=>capabilityFailures.push({id,name,category:'capability',reasons:[reason]});
  for(const [endpoint,payload] of [['config',config],['news',news]]){
    for(const [name,expected] of Object.entries(SOURCE_CAPABILITIES)){
      const capability=payload?.capabilities?.[name];
      if(!capability||capability.core!==expected.core||!sameIds(capability.sourceIds,expected.sourceIds)||capability.availability!==expected.availability){
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
    for(const id of endpoint==='news'?RETIRED_REPORTING_SOURCE_IDS:RETIRED_SOURCE_IDS){
      const source=sources.find(source=>source.id===id);
      if(!source||source.configured!==false||source.retired!==true)fail(id,`${endpoint} ${id}`,'Retired collector must be explicitly disabled; archived evidence may remain.');
    }
    const discovery=sources.filter(source=>source.id.startsWith('gdelt-')&&source.configured!==false);
    if(!sameIds(discovery.map(source=>source.id),DISCOVERY_IDS)||discovery.some(source=>source.configured!==true)){
      fail('discovery',`${endpoint} discovery configuration`,'No GDELT discovery collector may remain configured after retirement.');
    }
  }
  if(news?.coverage?.discoveryFamilies!==DISCOVERY_IDS.length||!sameIds(news?.coverage?.retiredSources,RETIRED_REPORTING_SOURCE_IDS)||news?.coverage?.reuters?.mode!=='retained-links-only'){
    fail('news-coverage','Reporting coverage schema','Discovery/retirement coverage does not match the configured collectors.');
  }
  for(const [endpoint,sources] of [['diagnostics',diagnosticSources],['maritime',maritimeSources]]){
    const source=sources.find(source=>source.id===ADVISORY_ID);
    if(!source||source.configured!==false||source.retired!==true||source.capability!=='supporting')fail(ADVISORY_ID,`${endpoint} MARAD adapter`,'The retired supporting MARAD collector must remain explicitly disabled with its historical identity.');
  }
  const advisories=Array.isArray(maritime?.advisories)?maritime.advisories:null;
  const coverage=maritime?.coverage?.advisories;
  if(!advisories||!Array.isArray(maritime?.events)||maritime?.coverage?.complete!==false||coverage?.incidentCoverage!==false||coverage?.status!=='unavailable'||coverage?.collection!=='retired'||coverage?.complete!==false){
    fail('advisory-schema','Maritime advisory schema','Separate historical advisory records and explicit unavailable, retired, incomplete, non-incident coverage are required.');
  }
  if(advisories?.some(record=>!record||record.sourceId!==ADVISORY_ID||record.recordKind!=='official-advisory'||record.recordType!=='advisory'||record.collectionRetired!==true||record.retainedFromHistory!==true||record.eventDate!==null||record.publishedDate!==null||!['active','cancelled'].includes(record.sourceStatus)||!['active','cancelled','superseded','expired','not-yet-effective','unknown'].includes(record.validityState))){
    fail('advisory-records','MARAD evidence semantics','Advisories must retain validity/source status without inventing incident or publication dates.');
  }
  if(Array.isArray(maritime?.events)&&maritime.events.some(record=>record?.sourceId===ADVISORY_ID||record?.recordType==='advisory'))fail('advisory-events','MARAD evidence semantics','Advisory records cannot be included as incidents or statements.');
  if(advisories?.length&&(coverage?.recordKind!=='official-advisory'||coverage?.cancelledArchiveComplete!==false||coverage?.publicationDateKnown!==false||!count(coverage?.activeListedCount)||!count(coverage?.cancelledListedCount)||coverage.activeListedCount!==advisories.filter(record=>record?.sourceStatus==='active').length||coverage.cancelledListedCount!==advisories.filter(record=>record?.sourceStatus==='cancelled').length)){
    fail('advisory-coverage','MARAD coverage semantics','Listed active/cancelled counts and incomplete history/unknown publication semantics must agree with retained records.');
  }
  const advisorySource=maritimeSources.find(source=>source.id===ADVISORY_ID),retrieved=timestamp(advisorySource?.retrievedAt);
  const retainedEvidenceEstablished=!!advisories?.length&&advisorySource?.recordCount===advisories.length&&Number.isFinite(retrieved)&&retrieved<=now+60000;
  if(advisories?.length&&!retainedEvidenceEstablished)fail('advisory-history','Retained advisory provenance','Retained advisory records require their original valid successful retrieval clock and matching source count.');
  warnings.push({id:ADVISORY_ID,name:'Official advisory coverage',category:'coverage',reasons:['Current official advisory coverage is unavailable. Retired historical records do not establish current coverage.'],retrievedAt:advisorySource?.retrievedAt??null});
  const failures=[...capabilityFailures,...coverageFailures];
  return {ready:failures.length===0,compatible:capabilityFailures.length===0,coverageEstablished:false,retainedEvidenceEstablished,capabilityFailures,coverageFailures,failures,warnings};
}
