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
  const failures=[],warnings=[];
  if(health?.application!=='passage-maritime-watch'||health?.status!=='ready')failures.push({id:'collector',name:'Passage collector',reasons:['Collector is not ready.']});
  if(!Array.isArray(requiredSources)||!requiredSources.length)failures.push({id:'configuration',name:'Required reporting',reasons:['No core reporting sources are configured for verification.']});
  const required=Array.isArray(requiredSources)?requiredSources:[];
  const sources=Array.isArray(diagnostics?.sources)?diagnostics.sources:[];
  let verifiedCount=0,recentReportingCount=0;
  for(const definition of required){
    const source=sources.find(source=>source?.id===definition.id),reasons=[];
    if(!source)reasons.push('Source is missing from collector diagnostics.');
    else {
      if(source.configured!==true)reasons.push('Required reporting source is not configured.');
      if(source.connection!=='connected')reasons.push('Source connection has not completed a successful update.');
      if(source.error||source.errorCategory||source.httpStatus>=400)reasons.push('The latest source update failed.');
      if(source.cacheIssue)reasons.push('Retrieved data could not be persisted reliably.');
      if(!['current','stale','empty'].includes(source.status))reasons.push('Source reporting status is not a successful checked result.');
      const hasRecords=Number.isInteger(source.recordCount)&&source.recordCount>0;
      if(!Number.isInteger(source.recordCount)||source.recordCount<0||hasRecords&&source.hasData===false||source.recordCount===0&&source.hasData===true)reasons.push('A consistent validated relevant report count is required.');
      const retrieved=timestamp(source.retrievedAt),published=timestamp(source.latestRelevant);
      const interval=Number.isFinite(definition.interval)&&definition.interval>0?definition.interval:300;
      const maxRetrievalAge=2*interval*1000+RETRIEVAL_GRACE_MS;
      if(!Number.isFinite(retrieved))reasons.push('Successful retrieval timestamp is missing or invalid.');
      else if(retrieved>now+RETRIEVAL_CLOCK_SKEW_MS)reasons.push('Successful retrieval timestamp is in the future.');
      else if(now-retrieved>maxRetrievalAge)reasons.push(`Successful retrieval is too old (over ${maxRetrievalAge/60000} minutes).`);
      if(hasRecords&&!Number.isFinite(published))reasons.push('Relevant publication timestamp is missing or invalid.');
      else if(Number.isFinite(published)&&published>now+PUBLICATION_CLOCK_SKEW_MS)reasons.push('Relevant publication timestamp is in the future.');
      else if(hasRecords&&now-published<=BRIEFING_WINDOW_MS)recentReportingCount++;
      else if(!reasons.length)warnings.push({id:definition.id,name:definition.name,category:'reporting-coverage',reasons:[hasRecords?'Source check succeeded; no relevant publication falls within the 72-hour briefing window.':'Source check succeeded; no relevant reports matched the current scope.'],retrievedAt:source.retrievedAt,latestRelevant:source.latestRelevant??null});
    }
    if(reasons.length)failures.push({id:definition.id,name:definition.name,reasons});
    else verifiedCount++;
  }
  if(required.length&&!recentReportingCount)failures.push({id:'briefing',name:'Recent direct reporting',reasons:['No direct publisher has a relevant publication within the 72-hour briefing window.']});
  return {ready:failures.length===0,requiredSourceIds:required.map(source=>source.id),verifiedCount,recentReportingCount,failures,warnings};
}

// Core homepage claims include dated prices and a checked official register.
// Fresh source checks and old event dates are compatible: lack of a recent
// incident is never a failed official-source check or a clear-water claim.
export function assessPassageReadiness(input={}){
  const reporting=assessReportingReadiness(input),now=input.now??Date.now(),failures=[...reporting.failures];
  const definitions=[
    {id:'imo-hormuz',name:'IMO Hormuz register',group:'maritime',maxCheckAge:24*60*60*1000},
    {id:'imo-redsea',name:'IMO Red Sea statements',group:'maritime',maxCheckAge:24*60*60*1000},
    // Ten calendar days is the UI's delayed daily-spot policy. It permits
    // weekends/holidays without presenting a check timestamp as a quote date.
    {id:'brent',name:'EIA Brent',group:'oil',maxCheckAge:3*60*60*1000,maxObservationAge:10*24*60*60*1000},
    {id:'wti',name:'EIA WTI',group:'oil',maxCheckAge:3*60*60*1000,maxObservationAge:10*24*60*60*1000},
  ];
  let verifiedCount=reporting.verifiedCount;
  for(const definition of definitions){
    const source=input.diagnostics?.sources?.find(value=>value.id===definition.id),reasons=[];
    if(!source)reasons.push('Core capability is missing from collector diagnostics.');
    else {
      if(source.configured!==true||source.connection!=='connected'||source.error||source.errorCategory||source.httpStatus>=400)reasons.push('The official source has not completed a successful current check.');
      if(source.cacheIssue)reasons.push('Retrieved source metadata could not be persisted reliably.');
      const check=timestamp(source.retrievedAt);
      if(!Number.isFinite(check)||check>now+RETRIEVAL_CLOCK_SKEW_MS||now-check>=definition.maxCheckAge)reasons.push('Successful retrieval is missing, future-dated or overdue.');
      if(!Number.isInteger(source.recordCount)||source.recordCount<0)reasons.push('A validated source result count is missing.');
      if(definition.group==='oil'){
        const observed=timestamp(source.latest);
        if(!source.recordCount||!Number.isFinite(observed)||observed>now||now-observed>=definition.maxObservationAge)reasons.push('No usable dated daily spot observation is available within the ten-day lag policy.');
      }
    }
    if(reasons.length)failures.push({id:definition.id,name:definition.name,reasons});else verifiedCount++;
  }
  return {...reporting,ready:failures.length===0,requiredSourceIds:[...reporting.requiredSourceIds,...definitions.map(value=>value.id)],verifiedCount,failures,reportingVerifiedCount:reporting.verifiedCount};
}
