import test from 'node:test';
import assert from 'node:assert/strict';
import {evidenceKind,evidenceKindLabel} from '../dist/evidence-kind.mjs';
import {reportInspectorMarkup} from '../dist/report-inspector.mjs';

test('publisher-supplied opinion and analysis genres remain explicit in the inspector',()=>{
  for(const type of ['Publisher opinion','Publisher analysis']){
    const record={recordKind:'publisher-report',type,title:'A publisher assessment',url:'https://example.com/assessment',source:'Publisher'};
    assert.equal(evidenceKind(record),'publisher-report');
    assert.equal(evidenceKindLabel(record),type);
    assert.ok(reportInspectorMarkup(record).includes(`<span>${type}</span>`));
  }
  assert.equal(evidenceKindLabel({type:'Reporting'}),'Publisher report');
  assert.equal(evidenceKindLabel({recordKind:'official-incident',type:'Publisher opinion'}),'Official register incident');
});
