const countOf = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const positions = count => `${count} received position${count === 1 ? '' : 's'}`;
const disabled = source => source.configured === false || source.status === 'disabled' && source.configured !== null && !source.configurationFailed;
const failed = source => Boolean(source.localFailure || source.configurationFailed || source.error || source.errorCategory
  || ['cached', 'unavailable', 'disconnected', 'error'].includes(source.connection) || source.checkStatus === 'failed');
const pending = source => !failed(source) && (source.configured === null || ['loading', 'connecting'].includes(source.connection));
const connected = source => source.configured !== null && source.connection === 'connected' && !failed(source);

/**
 * Plain-text guidance shared by the vessel panel and position list.
 *
 * Counts must come from the same geographic scope after position expiry:
 * allCount before the vessel-type filter, matchingCount after it. Provider
 * recordCount fields are deliberately ignored; they can include other areas
 * or expired records. This helper never changes positions or their clocks.
 *
 * Pass the vessel entries from collectSources(). Do not use the top-level
 * vessels.configured flag: it describes AISStream, not the public fallback.
 */
export function vesselAvailability({
  sources = [],
  hasSnapshot = false,
  requestFailed = false,
  autoRefresh = true,
  allCount = 0,
  matchingCount = allCount,
  typeFiltered = false,
  layerLabel = 'the selected vessel type',
  scopeLabel = 'the selected area',
} = {}) {
  const all = countOf(allCount), matching = Math.min(all, countOf(matchingCount));
  const vesselSources = sources.filter(source => source && (!source.group || source.group === 'vessels'));
  const enabled = vesselSources.filter(source => !disabled(source));
  const responding = enabled.filter(connected);
  const failures = enabled.filter(failed);
  const checking = enabled.some(pending);
  const allDisabled = vesselSources.length > 0 && enabled.length === 0;
  const sourcePaused = enabled.length > 0 && enabled.every(source => ['idle', 'paused'].includes(source.connection));
  let phase = 'unavailable';
  if (requestFailed) phase = 'unavailable';
  else if (allDisabled) phase = 'disabled';
  else if (failures.length && !responding.length && !checking) phase = 'unavailable';
  else if (!autoRefresh || sourcePaused) phase = 'paused';
  else if (!hasSnapshot || !responding.length && checking) phase = 'checking';
  else if (responding.length) phase = 'available';

  const retained = all > 0 && phase !== 'available';
  const canShowAll = typeFiltered && all > matching;
  const status = phase === 'available' ? !all ? 'empty' : !matching ? 'filtered' : 'available' : phase;
  const headings = {
    checking: 'Checking vessel reception',
    unavailable: 'Vessel update unavailable',
    disabled: 'Vessel sources not enabled',
    paused: 'Vessel refresh paused',
    empty: 'No received positions',
    filtered: 'No matching received positions',
    available: positions(matching),
  };
  const details = [];
  if (phase === 'checking') details.push('Vessel-source checks are still in progress.');
  if (phase === 'unavailable') details.push(requestFailed
    ? 'The latest vessel-data request failed.'
    : failures.some(source => source.configurationFailed)
      ? 'Vessel source configuration could not be checked.'
      : 'Vessel reception is unavailable.');
  if (phase === 'disabled') details.push('No vessel sources are enabled.');
  if (phase === 'paused') details.push(autoRefresh ? 'Vessel reception is paused.' : 'Automatic refresh is paused.');
  if (!requestFailed && failures.length && (responding.length || checking)) details.push(
    `${failures.length === 1 ? 'One vessel source is' : 'Some vessel sources are'} unavailable; coverage is incomplete.`);

  if (all) {
    if (retained) details.push(`${all} previously received position${all === 1 ? ' remains' : 's remain'} for ${scopeLabel}.`);
    if (matching) details.push(typeFiltered
      ? `${positions(matching)} ${matching === 1 ? 'matches' : 'match'} ${layerLabel} in ${scopeLabel}.`
      : `${positions(matching)} ${matching === 1 ? 'is' : 'are'} available for ${scopeLabel}.`);
    else details.push(`No received positions match ${layerLabel} in ${scopeLabel}.`);
    if (canShowAll) details.push(
      `${positions(all - matching)} ${all - matching === 1 ? 'is' : 'are'} hidden by the vessel-type filter. Choose All received to inspect ${positions(all)}.`);
    details.push('Original position timestamps are preserved; positions expire after 30 minutes.');
  } else if (phase === 'available') {
    details.push(`No usable provider positions are available for ${scopeLabel} in this snapshot. This is a coverage gap, not evidence that the waterway is empty.`);
  } else if (phase === 'checking') {
    details.push(`Position availability for ${scopeLabel} has not been established.`);
  } else {
    details.push(`No retained positions are available for ${scopeLabel}.`);
  }
  details.push('Reception is incomplete; received positions are not a traffic count.');
  return {
    status,
    heading: headings[status],
    detail: details.join(' '),
    count: all > 0 || phase === 'available' ? matching : null,
    retained,
    canShowAll,
    showAllLabel: canShowAll ? `Show all ${positions(all)}` : null,
  };
}
