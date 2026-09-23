// Keep only price observations: EIA's response also echoes the secret API key.
export function parseEIAApi(payload, expectedSeries, now = Date.now(), limit = 180) {
  const response = payload?.response;
  if (!Array.isArray(response?.data) || response.frequency !== 'daily') {
    throw new Error('Unexpected EIA daily series response');
  }
  const observations = new Map();
  for (const row of response.data) {
    if (row.series !== expectedSeries || row.units !== '$/BBL') {
      throw new Error('EIA series identity or units did not match');
    }
    const date = row.period;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const ms = Date.parse(date + 'T00:00:00Z');
    if (!Number.isFinite(ms) || ms > now || new Date(ms).toISOString().slice(0, 10) !== date) continue;
    if (!['number', 'string'].includes(typeof row.value) || String(row.value).trim() === '') continue;
    const value = Number(row.value);
    if (!Number.isFinite(value)) continue;
    observations.set(date, { date, value });
  }
  if (!observations.size) throw new Error('EIA returned no valid price observations');
  return { observations: [...observations.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-Math.max(1,Math.min(800,limit))), releaseDate: null };
}
