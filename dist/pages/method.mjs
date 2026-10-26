// Method: every source with its live status. The rest of the page is static.
import '../site/shell.mjs';
import { $, load, every, stamp } from '../site/data.mjs';
import { sourceRowsMarkup, sourceState, statusSummary, clockLabel } from '../ops/panels.mjs';

async function loadSources() {
  let sources;
  try { sources = (await load('/api/diagnostics')).sources || []; }
  catch {
    stamp($('#sources-stamp'), 'Unavailable', 'down');
    $('#sources-body').innerHTML = '<tr><td colspan="3" class="error-note">Source status is unavailable right now. The page retries every minute.</td></tr>';
    $('#method-proof').innerHTML = '<li><span class="error-note">Source status unavailable</span></li>';
    $('#hero-eyebrow').dataset.state = 'down';
    return;
  }
  const used = sources.filter(s => s && sourceState(s) !== 'idle'), live = used.filter(s => sourceState(s) === 'live').length, summary = statusSummary(sources);
  $('#sources-body').innerHTML = sourceRowsMarkup(sources) || '<tr><td colspan="3" class="empty-note">No source has reported yet.</td></tr>';
  $('#method-proof').innerHTML = `<li><span class="label">Sources current</span><span class="value">${live} of ${used.length}</span><span class="note">checked ${clockLabel(new Date().toISOString())}</span></li>`;
  $('#hero-eyebrow').dataset.state = summary.state === 'live' ? 'live' : summary.state === 'down' ? 'down' : 'stale';
  stamp($('#sources-stamp'), `Checked ${clockLabel(new Date().toISOString())}`);
}
every(60_000, loadSources);
