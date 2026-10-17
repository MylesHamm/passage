// Stable evidence kinds, shared by ledger, inspector, graph/export and speech.
// Display prose is not a discriminator once a record has a validated kind.
export const EVIDENCE_KINDS=Object.freeze({
  'official-incident':'Official register incident',
  'official-statement':'Official statement',
  'official-advisory':'Official advisory',
  'publisher-report':'Publisher report',
  'agency-assessment':'Agency assessment',
  'independent-analysis':'Independent analysis',
  'forecast':'Forecast',
  'market-observation':'Market observation',
  'structured-event':'Structured event record',
  'user-note':'User note',
});
export function evidenceKind(record={}){
  if(Object.hasOwn(EVIDENCE_KINDS,record.recordKind))return record.recordKind;
  if(record.manual||record.recordType==='note')return 'user-note';
  if(record.recordType==='advisory')return 'official-advisory';
  if(record.recordType==='incident'||record.evidenceStatus==='confirmed-by-source')return 'official-incident';
  if(record.recordType==='assessment'||['Agency assessment','agency-assessment'].includes(record.evidenceStatus)||record.type==='Official energy analysis')return 'agency-assessment';
  if(record.type==='Independent energy analysis')return 'independent-analysis';
  if(record.recordType==='forecast')return 'forecast';
  if(record.recordType==='statement'||record.evidenceStatus==='official-statement'||record.type==='Official statement')return 'official-statement';
  if(record.observationDate&&Number.isFinite(record.value))return 'market-observation';
  return 'publisher-report';
}
export function evidenceKindLabel(record){return EVIDENCE_KINDS[evidenceKind(record)];}
export function withEvidenceKind(record){return {...record,recordKind:evidenceKind(record)};}
