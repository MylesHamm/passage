import {SOURCE_CAPABILITIES,RETIRED_SOURCE_IDS} from '../../dist/source-policy.mjs';

export function backendFixture(now=Date.parse('2026-09-28T19:00:00Z')){
  const retrievedAt=new Date(now-60000).toISOString();
  const source={configured:true,capability:'supporting',connection:'connected',status:'current',retrievedAt,checkedAt:retrievedAt,recordCount:1};
  const advisory={id:'marad-advisories:2026-011',advisoryId:'2026-011',sourceId:'marad-advisories',recordKind:'official-advisory',recordType:'advisory',sourceStatus:'active',validityState:'active',effectiveDate:'2026-09-09',expiresDate:'2027-03-08',eventDate:null,publishedDate:null};
  const advisories=[advisory],marad={...source,id:'marad-advisories'};
  const newsSources=[...SOURCE_CAPABILITIES.discovery.sourceIds.map(id=>({...source,id,interval:1800})),...RETIRED_SOURCE_IDS.map(id=>({id,configured:false,retired:true,connection:'cached',retrievedAt:'2026-08-01T00:00:00Z',recordCount:3}))];
  return structuredClone({now,config:{capabilities:SOURCE_CAPABILITIES},diagnostics:{sources:[marad,...newsSources]},news:{sources:newsSources,capabilities:SOURCE_CAPABILITIES,coverage:{discoveryFamilies:2,retiredSources:RETIRED_SOURCE_IDS,reuters:{mode:'retained-links-only'}}},maritime:{events:[],advisories,sources:[marad],coverage:{complete:false,advisories:{recordKind:'official-advisory',incidentCoverage:false,activeListedCount:1,cancelledListedCount:0,cancelledArchiveComplete:false,publicationDateKnown:false}}}});
}
