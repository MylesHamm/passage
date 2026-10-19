import {SOURCE_CAPABILITIES,RETIRED_REPORTING_SOURCE_IDS} from '../../dist/source-policy.mjs';

export function backendFixture(now=Date.parse('2026-09-28T19:00:00Z')){
  const retrievedAt=new Date(now-60000).toISOString();
  const advisory={id:'marad-advisories:2026-011',advisoryId:'2026-011',sourceId:'marad-advisories',recordKind:'official-advisory',recordType:'advisory',sourceStatus:'active',validityState:'active',effectiveDate:'2026-09-09',expiresDate:'2027-03-08',eventDate:null,publishedDate:null,collectionRetired:true,retainedFromHistory:true};
  const marad={id:'marad-advisories',configured:false,retired:true,capability:'supporting',connection:'cached',status:'disabled',retrievedAt,checkedAt:retrievedAt,recordCount:1};
  const newsSources=RETIRED_REPORTING_SOURCE_IDS.map(id=>({id,configured:false,retired:true,connection:'cached',retrievedAt:'2026-08-01T00:00:00Z',recordCount:3}));
  return structuredClone({now,config:{capabilities:SOURCE_CAPABILITIES},diagnostics:{sources:[marad,...newsSources]},news:{sources:newsSources,capabilities:SOURCE_CAPABILITIES,coverage:{discoveryFamilies:0,retiredSources:RETIRED_REPORTING_SOURCE_IDS,reuters:{mode:'retained-links-only'}}},maritime:{events:[],advisories:[advisory],sources:[marad],coverage:{complete:false,advisories:{status:'unavailable',collection:'retired',complete:false,recordKind:'official-advisory',incidentCoverage:false,activeListedCount:1,cancelledListedCount:0,cancelledArchiveComplete:false,publicationDateKnown:false}}}});
}
