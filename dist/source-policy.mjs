// Collection policy is separate from archived evidence. Retiring a collector
// never deletes its records, original clocks, provider history or source links.
export const CORE_REPORTING_IDS=Object.freeze(['bbc','aj','mee','memo','france24']);
export const RETIRED_REPORTING_SOURCE_IDS=Object.freeze(['centcom','gdelt-hormuz','gdelt-redsea','gdelt-exports','gdelt-energy','gdelt-reuters']);
export const RETIRED_SOURCE_IDS=Object.freeze([...RETIRED_REPORTING_SOURCE_IDS,'marad-advisories']);
export const SOURCE_CAPABILITIES=Object.freeze({
  reporting:Object.freeze({core:true,sourceIds:CORE_REPORTING_IDS,basis:'Selected direct publisher metadata; not complete reporting coverage'}),
  maritime:Object.freeze({core:true,sourceIds:Object.freeze(['imo-hormuz','imo-redsea']),basis:'IMO incident register and dated statements; advisory and incident coverage is incomplete'}),
  oil:Object.freeze({core:true,sourceIds:Object.freeze(['brent','wti']),basis:'Dated EIA daily spot observations'}),
  advisories:Object.freeze({core:false,sourceIds:Object.freeze([]),availability:'unavailable',basis:'Current official advisory coverage unavailable; retained advisory metadata is historical, not incident coverage'}),
  discovery:Object.freeze({core:false,sourceIds:Object.freeze([]),availability:'retired',basis:'Discovery collection retired; dated metadata remains available in the historical archive'}),
});
export function sourceConfigured(definition,config={}){
  if(definition.defaultEnabled===false||RETIRED_SOURCE_IDS.includes(definition.id))return false;
  return definition.optional?!!config[definition.optional]:true;
}
