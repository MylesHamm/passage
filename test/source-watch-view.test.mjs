import test from 'node:test';
import assert from 'node:assert/strict';
import {renderSourceWatch} from '../dist/source-watch-view.mjs';

test('source watch never claims automatic discovery and preserves source uncertainty',()=>{
 const html=renderSourceWatch({sourceWatch:{items:[{url:'https://x.com/HormuzLetter/status/123',summary:'Iran appears to have struck <site>',publishedAt:'2026-09-30T00:00:00Z'}],source:{connection:'connected',retrievedAt:'2026-09-30T17:00:00Z'}}});
 assert.match(html,/appears to have struck &lt;site&gt;/);assert.match(html,/New posts are not discovered automatically/);assert.match(html,/2026-09-30 17:00 UTC/);assert.match(html,/Read full post &amp; maps/);
});
test('source watch failure retains original clock and rejects unsafe links',()=>{
 const html=renderSourceWatch({failures:{sourceWatch:true},sourceWatch:{items:[{url:'https://x.com/HormuzLetter/status/123',summary:'Retained excerpt'},{url:'javascript:alert(1)',summary:'UNSAFE'}],source:{retrievedAt:'2026-09-29T12:00:00Z'}}});
 assert.match(html,/Update failed · retained excerpts/);assert.match(html,/2026-09-29 12:00 UTC/);assert.doesNotMatch(html,/UNSAFE|javascript:/);
});

test('source watch ages the retained retrieval even when the view is paused',()=>{
 const html=renderSourceWatch({auto:false,sourceWatch:{source:{connection:'connected',status:'current',retrievedAt:'2026-09-30T10:00:00Z'},items:[]}},Date.parse('2026-09-30T10:16:00Z'));
 assert.match(html,/Tracked-post check overdue/);assert.match(html,/view refresh paused/);
});
