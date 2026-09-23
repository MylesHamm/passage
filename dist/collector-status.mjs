// Completion is the collection clock. Response generation and browser checks
// cannot establish that a scheduled source cycle actually finished.
export const COLLECTOR_DELAY_MS = 2 * 300 * 1000;
const instant = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const problem = value => typeof value === 'string' ? value.trim().slice(0, 500) : '';
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const displayTime = value => value ? new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }) + ' UTC' : 'Not supplied';

export function collectorHealth(collection, now = Date.now()) {
  const data = collection && typeof collection === 'object' ? collection : {};
  const suppliedCompletion = instant(data.lastCompletedAt);
  const futureCompletion = suppliedCompletion !== null && Date.parse(suppliedCompletion) > now + 60000;
  const lastCompletedAt = futureCompletion ? null : suppliedCompletion;
  const lastAttemptAt = instant(data.lastAttemptAt), nextAttemptAt = instant(data.nextAttemptAt);
  const ageMs = lastCompletedAt ? Math.max(0, now - Date.parse(lastCompletedAt)) : null;
  const delayed = ageMs !== null && ageMs >= COLLECTOR_DELAY_MS;
  const error = problem(data.error), persistenceError = problem(data.persistenceError);
  const status = data.active === false ? 'paused' : error ? 'failed' : delayed ? 'delayed' : persistenceError ? 'unsaved' : data.active !== true || !lastCompletedAt ? 'unverified' : data.collecting ? 'collecting' : 'completed';
  const label = ({ paused: 'Background collection paused', failed: 'Background check failed', delayed: 'Background check delayed', unsaved: 'Collector storage needs attention', unverified: 'Background check unverified', collecting: 'Background check running', completed: 'Background check completed' })[status];
  const attention = !['completed', 'collecting'].includes(status);
  const completion = lastCompletedAt ? `Last completed background check: ${displayTime(lastCompletedAt)}.` : futureCompletion ? 'The supplied completion time is in the future and cannot establish a recent check.' : 'No valid completed background check has been received.';
  const meaning = status === 'paused' ? 'The collector reports that background collection is paused.'
    : delayed ? 'No completed cycle has been reported for at least 10 minutes; the expected interval is 5 minutes.'
    : status === 'failed' ? 'The latest collection attempt did not finish.'
    : status === 'unsaved' ? 'A collector checkpoint could not be saved; recovery of recent observations is not assured.'
    : status === 'unverified' ? 'Scheduled collection has not been verified.'
    : 'A completed cycle does not mean every provider succeeded or published new data.';
  const detail = `${futureCompletion ? completion + ' ' : ''}${meaning}${attention ? ' Available observations keep their original source timestamps.' : ''}`;
  const notice = `${label}${lastCompletedAt ? ` · last completed ${displayTime(lastCompletedAt)}` : ' · no valid completion time'}.${delayed ? ' No completed cycle for at least 10 minutes.' : ''}`;
  return { status, label, attention, delayed, ageMs, lastCompletedAt, lastAttemptAt, nextAttemptAt, error, persistenceError, detail, notice,
    summary: `${label}. ${completion} ${meaning}${attention ? ' Available observations keep their original source timestamps.' : ''}` };
}

export function collectorCard(collection, now = Date.now()) {
  const health = collectorHealth(collection, now);
  const time = value => value ? `<time datetime="${escape(value)}">${escape(displayTime(value))}</time>` : 'Not supplied';
  return `<section class="source-card" aria-labelledby="collector-heading"><div><strong id="collector-heading">Background collection</strong><span class="source-state ${health.attention ? 'stale' : ''}">${escape(health.label)}</span></div><p>Last completed background check: ${time(health.lastCompletedAt)}<br>Last attempt: ${time(health.lastAttemptAt)}<br>Scheduled next attempt: ${time(health.nextAttemptAt)}</p><p>${escape(health.detail)}</p>${health.error ? `<p>Collection issue: ${escape(health.error)}</p>` : ''}${health.persistenceError ? `<p>Storage issue: ${escape(health.persistenceError)}</p>` : ''}<p>Schedule times are plans, not confirmation that a check ran. Browser refresh and response-generation times are separate. Individual provider results remain listed below.</p></section>`;
}
