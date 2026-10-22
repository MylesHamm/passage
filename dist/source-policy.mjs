// Collection policy is separate from archived evidence. Retiring a collector
// never deletes its records, original clocks, provider history or source links.
export const CORE_REPORTING_IDS=Object.freeze(['bbc','aj','mee','memo','france24']);
export const RETIRED_REPORTING_SOURCE_IDS=Object.freeze([]);
export const RETIRED_SOURCE_IDS=Object.freeze([]);
export const SOURCE_CAPABILITIES=Object.freeze({
  reporting:Object.freeze({core:true,sourceIds:CORE_REPORTING_IDS,basis:'Selected direct publisher metadata; not complete reporting coverage'}),
  maritime:Object.freeze({core:true,sourceIds:Object.freeze(['imo-hormuz','imo-redsea']),basis:'IMO incident register and dated statements; advisory and incident coverage is incomplete'}),
  oil:Object.freeze({core:true,sourceIds:Object.freeze(['brent','wti']),basis:'Dated EIA daily spot observations and next-day closes'}),
  transits:Object.freeze({core:false,sourceIds:Object.freeze(['portwatch']),basis:'IMF PortWatch daily chokepoint transits; weekly release'}),
  events:Object.freeze({core:false,sourceIds:Object.freeze(['curated-events']),basis:'Curated, source-linked war events read from the repository every ten minutes'}),
});
export function sourceConfigured(definition,config={}){
  if(definition.defaultEnabled===false||RETIRED_SOURCE_IDS.includes(definition.id))return false;
  return definition.optional?!!config[definition.optional]:true;
}
