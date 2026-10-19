import test from 'node:test';
import assert from 'node:assert/strict';
import {publisherPreview} from '../dist/publisher-preview.mjs';
test('encoded quoted attribute text never becomes publisher prose', () => {
  const encoded='&lt;p title=&quot;Iran &gt; oil tanker attack&quot;&gt;A public culture preview.&lt;/p&gt;';
  for(const value of [encoded,encoded.replaceAll('&','&amp;'),'<p title="Iran > oil tanker attack">A public culture preview.</p>'])assert.equal(publisherPreview(value),'A public culture preview.');
  assert.equal(publisherPreview('&lt;article title=&quot;Iran &gt; oil tanker attack'),'');
});
test('retained HTML feed excerpts display prose without markup or executable contents', () => {
  assert.equal(publisherPreview('&lt;p&gt;Oil &amp;amp; shipping&lt;/p&gt;'), 'Oil & shipping');
  assert.equal(publisherPreview('<p>Port report</p><script>bad()</script><style>x{}</style>'), 'Port report');
  assert.equal(publisherPreview('<article data-node="1"><h2><a href="https://source.test/truncated…'), '');
});
test('plain text, numeric entities and mathematical comparisons remain readable', () => {
  assert.equal(publisherPreview('Oil rose &#36;2; exports < 5 million b/d.'), 'Oil rose $2; exports < 5 million b/d.');
  assert.equal(publisherPreview(null), '');
});
