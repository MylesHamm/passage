import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {EXPOSURE_BASELINE,CONTEXT_SOURCES} from '../dist/energy-context.mjs';
import {renderExposureBaselineMarkup} from '../dist/exposure-view.mjs';
import {buildPages} from '../scripts/build-pages.mjs';

test('historical flows retain both quantities, units, period and a source with each figure',()=>{
  const original=structuredClone(EXPOSURE_BASELINE),html=renderExposureBaselineMarkup();
  const cards=[...html.matchAll(/<article class="exposure-flow">([\s\S]*?)<\/article>/g)].map(match=>match[1]);
  assert.equal(cards.length,2);
  for(const [index,value] of ['20.9','4.2'].entries()){
    assert.ok(cards[index].includes(`<strong>${value}</strong> <span>million barrels per day</span>`));
    assert.match(cards[index],/Baseline period<\/span> <strong>H1 2025<\/strong>/);
    assert.match(cards[index],/crude, condensate and petroleum products/);
    assert.ok(cards[index].includes(`href="${CONTEXT_SOURCES.eia.url}"`));
  }
  assert.match(html,/historical flows, not current throughput/);
  assert.match(html,/does not establish its current operating status or available capacity/);
  assert.deepEqual(EXPOSURE_BASELINE,original);
});

test('scope filtering preserves the different oil-flow and route-context meanings',()=>{
  const hormuz=renderExposureBaselineMarkup({theater:'hormuz'}),bab=renderExposureBaselineMarkup({theater:'bab'});
  assert.match(hormuz,/<h4>Hormuz<\/h4>/);assert.doesNotMatch(hormuz,/<h4>Bab el-Mandeb<\/h4>/);
  assert.match(hormuz,/<h4>Saudi bypass<\/h4>/);assert.match(hormuz,/<h4>UAE bypass<\/h4>/);
  assert.match(bab,/<h4>Bab el-Mandeb<\/h4>/);assert.doesNotMatch(bab,/<h4>Hormuz<\/h4>|<h4>UAE bypass<\/h4>/);
  assert.match(bab,/<h4>Saudi bypass<\/h4>/);
  assert.match(renderExposureBaselineMarkup({theater:'unlisted'}),/No historical exposure baseline is listed/);
});

test('dated local route context keeps its statement link without implying current availability',()=>{
  const html=renderExposureBaselineMarkup();
  assert.match(html,/<p class="exposure-route-status" data-state="historical">Dated statement · shutdown reported Sep 11, 2026; see dated evidence\.<\/p>/);
  assert.ok(html.includes(`href="${CONTEXT_SOURCES.saudi.url}"`));
  assert.match(html,/Saudi Ministry · dated statement/);
  assert.doesNotMatch(html,/operating now|available now|live throughput|Status matters/i);
  assert.match(html,/<p class="exposure-route-value">Fujairah · Export outlet outside Hormuz<\/p><p class="exposure-route-status" data-state="unavailable">Current status unavailable<\/p>/);
});

test('the public renderer respects sanitized route context and never recreates private dated claims',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'passage-exposure-'));
  try{
    await buildPages({outputDir:join(directory,'public')});
    const {renderExposureBaselineMarkup:renderPublic}=await import(pathToFileURL(join(directory,'public/exposure-view.mjs')));
    const html=renderPublic();
    assert.match(html,/current operating status not connected/);
    assert.doesNotMatch(html,/shutdown reported|Sep 11|Saudi Ministry · dated statement|Status matters/);
    assert.equal([...html.matchAll(/data-state="unavailable">Current status unavailable/g)].length,2);
    assert.match(html,/<p class="exposure-route-value">East–West to Yanbu<\/p><p class="exposure-route-status" data-state="unavailable">Current status unavailable<\/p>/);
    assert.match(html,/<p class="exposure-route-value">Fujairah · Export outlet outside Hormuz<\/p>/);
    assert.ok(!html.includes(CONTEXT_SOURCES.saudi.url));
    assert.match(html,/<strong>20\.9<\/strong>/);assert.match(html,/<strong>4\.2<\/strong>/);
  }finally{await rm(directory,{recursive:true,force:true});}
});
