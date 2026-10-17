// Collection policy is separate from archived evidence. Retiring a collector
// never deletes its records, original clocks, provider history or source links.
export const CORE_REPORTING_IDS=Object.freeze(['bbc','aj','mee','memo','france24']);
export const RETIRED_SOURCE_IDS=Object.freeze(['centcom','gdelt-exports','gdelt-energy','gdelt-reuters']);
export const SOURCE_CAPABILITIES=Object.freeze({
  reporting:Object.freeze({core:true,sourceIds:CORE_REPORTING_IDS,basis:'Selected direct publisher metadata; not complete reporting coverage'}),
  maritime:Object.freeze({core:true,sourceIds:Object.freeze(['imo-hormuz','imo-redsea']),basis:'IMO incident register and dated statements; advisory and incident coverage is incomplete'}),
  oil:Object.freeze({core:true,sourceIds:Object.freeze(['brent','wti']),basis:'Dated EIA daily spot observations'}),
  advisories:Object.freeze({core:false,sourceIds:Object.freeze(['marad-advisories']),basis:'U.S. maritime advisory validity and source status; not incident coverage'}),
  discovery:Object.freeze({core:false,sourceIds:Object.freeze(['gdelt-hormuz','gdelt-redsea']),basis:'Bounded maritime-route metadata leads; excluded from the default priority brief'}),
});
export function sourceConfigured(definition,config={}){
  if(definition.defaultEnabled===false||RETIRED_SOURCE_IDS.includes(definition.id))return false;
  return definition.optional?!!config[definition.optional]:true;
}
