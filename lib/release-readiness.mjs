import {SOURCES,publisherDateMillis} from './feeds.mjs';

// Release policy for the direct reporting behind the 72-hour live briefing.
// A collector heartbeat proves neither provider access nor useful reporting.
// Auxiliary discovery, official statements and optional account feeds retain
// their independent coverage warnings; passing this gate is not total coverage.
const BRIEFING_WINDOW_MS=72*60*60*1000;
const RETRIEVAL_GRACE_MS=2*60*1000;
const RETRIEVAL_CLOCK_SKEW_MS=60*1000;
const PUBLICATION_CLOCK_SKEW_MS=5*60*1000;
const timestamp=value=>typeof value==='string'&&value.trim()?publisherDateMillis(value):NaN;

export function assessReportingReadiness({health,diagnostics,now=Date.now(),requiredSources=SOURCES.filter(source=>source.type==='Reporting')}={}){
  const failures=[];
  if(health?.application!=='passage-maritime-watch'||health?.status!=='ready')failures.push({id:'collector',name:'Passage collector',reasons:['Collector is not ready.']});
  if(!Array.isArray(requiredSources)||!requiredSources.length)failures.push({id:'configuration',name:'Required reporting',reasons:['No core reporting sources are configured for verification.']});
  const required=Array.isArray(requiredSources)?requiredSources:[];
  const sources=Array.isArray(diagnostics?.sources)?diagnostics.sources:[];
  let verifiedCount=0;
  for(const definition of required){
    const source=sources.find(source=>source?.id===definition.id),reasons=[];
    if(!source)reasons.push('Source is missing from collector diagnostics.');
    else {
      if(source.configured!==true)reasons.push('Required reporting source is not configured.');
      if(source.connection!=='connected')reasons.push('Source connection has not completed a successful update.');
      if(source.error||source.errorCategory||source.httpStatus>=400)reasons.push('The latest source update failed.');
      if(source.cacheIssue)reasons.push('Retrieved data could not be persisted reliably.');
      if(source.status!=='current')reasons.push('Source reporting status is not current.');
      if(!Number.isInteger(source.recordCount)||source.recordCount<=0||source.hasData===false)reasons.push('No usable relevant report records were verified.');
      const retrieved=timestamp(source.retrievedAt),published=timestamp(source.latestRelevant);
      const interval=Number.isFinite(definition.interval)&&definition.interval>0?definition.interval:300;
      const maxRetrievalAge=2*interval*1000+RETRIEVAL_GRACE_MS;
      if(!Number.isFinite(retrieved))reasons.push('Successful retrieval timestamp is missing or invalid.');
      else if(retrieved>now+RETRIEVAL_CLOCK_SKEW_MS)reasons.push('Successful retrieval timestamp is in the future.');
      else if(now-retrieved>maxRetrievalAge)reasons.push(`Successful retrieval is too old (over ${maxRetrievalAge/60000} minutes).`);
      if(!Number.isFinite(published))reasons.push('Relevant publication timestamp is missing or invalid.');
      else if(published>now+PUBLICATION_CLOCK_SKEW_MS)reasons.push('Relevant publication timestamp is in the future.');
      else if(now-published>BRIEFING_WINDOW_MS)reasons.push('No relevant publication falls within the 72-hour briefing window.');
    }
    if(reasons.length)failures.push({id:definition.id,name:definition.name,reasons});
    else verifiedCount++;
  }
  return {ready:failures.length===0,requiredSourceIds:required.map(source=>source.id),verifiedCount,failures};
}
