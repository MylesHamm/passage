import test from 'node:test';
import assert from 'node:assert/strict';
import { casualtyFigures, figureWarnings } from '../lib/event-lint.mjs';

test('casualty figures are read from headlines, in digits or words, and other numbers are ignored', () => {
  assert.deepEqual(casualtyFigures('Sanaa Health Ministry: 13 killed, injured in Saudi airstrike'), [13]);
  assert.deepEqual(casualtyFigures('Iran strikes towns near Israel\'s key nuclear site, at least 180 wounded'), [180]);
  assert.deepEqual(casualtyFigures('Three killed, 36 injured in Houthi attacks on Saudi airports'), [3, 36]);
  assert.deepEqual(casualtyFigures("Yemen's Houthis say 11 killed in strikes on Sanaa; Saudis say two missiles shot down"), [11]);
  assert.deepEqual(casualtyFigures('Coalition forces down missiles and drone'), []);
});

// The 25 October Hamdan record: the cited headline said 13 killed or injured,
// while its body gave the health ministry's revised 8 killed and 15 injured.
const hamdan = {
  id: '2026-10-24-hamdan-cement-workers-housing-strike',
  title: "Houthis claim Saudi strike on cement workers' housing in Hamdan, Sanaa, killed civilians",
  summary: 'Houthi-run Al-Masirah claimed a Saudi strike on housing for cement factory workers killed six women and a child. The Sanaa health ministry later put it in Hamdan district, with 8 killed and 15 hurt.',
  sources: [{ publisher: 'Yemen Press Agency (Houthi-aligned)', title: "Sanaa Health Ministry: 13 killed, injured in Saudi airstrike on cement factory workers' housing" }],
};

test('a headline figure the summary never mentions is flagged for review', () => {
  assert.deepEqual(figureWarnings(hamdan), [{ id: hamdan.id, publisher: 'Yemen Press Agency (Houthi-aligned)', title: hamdan.sources[0].title, missing: [13] }]);
});

test('no warning once the summary accounts for the headline figure, in digits or words', () => {
  assert.deepEqual(figureWarnings({ ...hamdan, summary: `${hamdan.summary} Its headline gives an earlier 13.` }), []);
  assert.deepEqual(figureWarnings({ ...hamdan, sources: [{ publisher: 'X', title: 'Six killed in attack' }], summary: 'Officials said six were killed.' }), []);
  assert.deepEqual(figureWarnings({ id: 'x', title: 't', summary: 's', sources: [] }), []);
});
