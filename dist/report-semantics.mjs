// Only analysis inputs are masked. Original source titles/previews are never
// rewritten. Financial price/equity movements are not physical disruptions.
const MOVEMENT='(?:sink\\w*|sank|sunk|plung\\w*|crash\\w*|slump\\w*|tumbl\\w*|rout\\w*)';
const FINANCIAL_NOUN='(?:stocks?|shares?|equities|prices?|markets?|indices|indexes)';
const MODIFIER='(?:(?:further|sharply|again|may|could|might|will|are|have|has|to|continue|began|start|expected|set)\\s+){0,3}';
const FINANCIAL_MOVEMENT=new RegExp('\\b'+FINANCIAL_NOUN+'\\s+'+MODIFIER+MOVEMENT+'\\b','gi');
const LEADING_MOVEMENT=new RegExp('\\b'+MOVEMENT+'\\s+'+FINANCIAL_NOUN+'\\b','gi');
export function physicalClaimText(value=''){
  return String(value).replace(FINANCIAL_MOVEMENT,'financial movement').replace(LEADING_MOVEMENT,'financial movement').replace(/\bstrike prices?\b/gi,'option price');
}
export function petroleumInventoryMention(value=''){
  // Unqualified "stocks" can mean equities. Require a petroleum qualifier;
  // explicit inventories/demand remain separate topic matches in the caller.
  return /\b(?:oil|crude(?:\s+oil)?|petroleum|fuel|diesel|gasoline|distillate)\s+(?:(?:commercial|strategic|emergency)\s+)?stocks?\b|\bstrategic (?:petroleum |oil )?reserves?\b/i.test(String(value));
}
