const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

// Original schematic artwork. These assemblies represent mechanisms, never the
// operating state of a particular terminal, vessel, route or market instrument.
const base = `<path class="system-art-shadow" d="M-85 12 0-27 85 12 0 51Z"/>
  <path class="system-art-side" d="M-76 0 0 35 76 0V10L0 45-76 10Z"/>
  <path class="system-art-base" d="M-76 0 0-35 76 0 0 35Z"/>
  <path class="system-art-ring" d="M-84 1 0-38 84 1 0 40Z"/>`;

function tank(x, y, radius = 16, height = 34) {
  return `<g transform="translate(${x} ${y})">
    <path class="system-art-white" d="M${-radius} ${-height}v${height}c0 10 ${radius * 2} 10 ${radius * 2} 0v${-height}Z"/>
    <ellipse class="system-art-top" cx="0" cy="${-height}" rx="${radius}" ry="7"/>
    <path class="system-art-detail" d="M${-radius} ${-height + 12}c0 10 ${radius * 2} 10 ${radius * 2} 0M${-radius} -6c0 10 ${radius * 2} 10 ${radius * 2} 0"/>
    <path class="system-art-line" d="M${radius - 6} ${-height + 7}v${height - 6}"/>
  </g>`;
}

const drawings = {
  supply: `<path class="system-art-pipe" d="M-52 6-26 18 18-2 46 10"/>
    ${tank(-31, -14, 17, 32)}${tank(8, -32, 20, 41)}
    <path class="system-art-side" d="m30-8 21-10 17 8v20L48 20 30 10Z"/>
    <path class="system-art-white" d="m30-8 18 8 20-10-17-8Z"/>
    <path class="system-art-line" d="M48 0v20M55-5v-34m0 0 10-5m-10 5-6-3m16-2v23"/>
    <path class="system-art-detail" d="m34 1 8 4m-8 1 8 4"/>`,
  transport: `<path class="system-art-water" d="m-68 9 54 25 77-36M-65 16l45 21M28 25l36-17"/>
    <path class="system-art-hull" d="m-66-14 28 28 20 8L66-17 55-36Z"/>
    <path class="system-art-white" d="m-66-14 101-47 20 25L-18-1Z"/>
    <path class="system-art-side" d="M-18-1v23L66-17 55-36Z"/>
    <path class="system-art-top" d="m-55-16 84-39 13 14L-21-11Z"/>
    <path class="system-art-accent" d="m-24-27 7 3 49-23-7-3Z"/>
    <path class="system-art-detail" d="m-8-40 13 14m1-21 13 14m1-21 13 14M-47-19l9 4"/>
    <path class="system-art-white" d="m-48-24 14-7 14 7v-13l-14-7-14 7Z"/>
    <path class="system-art-top" d="m-48-37 14-7 14 7-14 7Z"/>
    <path class="system-art-line" d="M-34-30v13m0-27v-12m0 1 10 5"/>
    <path class="system-art-detail" d="m-44-30 6 3m10 0 5-3"/>`,
  risk: `<path class="system-art-side" d="m-39-53 36-17 36 17v58L-3 22-39 5Z"/>
    <path class="system-art-paper" d="m-39-59 36-17 36 17L-3-42Z"/>
    <path class="system-art-white" d="M-39-59-3-42v59L-39 0Z"/>
    <path class="system-art-line" d="m-31-44 20 9m-20 2 20 9m-20 2 14 6"/>
    <path class="system-art-shield" d="m11-34 16-8 22 6v23C48 1 41 10 27 21 13 17 6 11 6-2v-24Z"/>
    <path class="system-art-shield-seam" d="M27-42v63"/>
    <path class="system-art-line" d="m18-9 7 5 13-18"/>`,
  benchmarks: `${tank(-32, 6, 14, 37)}${tank(-6, 18, 14, 37)}
    <path class="system-art-side" d="m8-39 37-17 19 9v47L27 17 8 8Z"/>
    <path class="system-art-top" d="m8-39 37-17 19 9-37 17Z"/>
    <path class="system-art-instrument" d="m27-30 37-17v47L27 17Z"/>
    <path class="system-art-detail" d="m34-23 23-11m-23 23 23-11m-23 23 23-11"/>
    <path class="system-art-line" d="M16-37v-34m0 0 29-13m0 0v29"/>
    <circle class="system-art-indicator" cx="33" cy="8" r="2"/>`,
};

const shortLabels = { supply: 'Exports', transport: 'Passage & freight', risk: 'Security & cover', benchmarks: 'Oil benchmarks' };

export function oilSystemArt(stages) {
  const parts = stages.map((stage, index) => `<g class="system-part${stage.selected ? ' is-selected' : ''}${stage.matched ? ' is-matched' : ''}" data-system-part="${escape(stage.id)}" style="transform:translate(${stage.position.x}px,${stage.position.y}px)">
    <title>${escape(stage.title)}. Select to inspect this conceptual part of the oil system.</title>
    ${base}${drawings[stage.id] || ''}
    <g class="system-art-number" transform="translate(-62 -68)"><circle r="13"/><text text-anchor="middle" y="4">${index + 1}</text></g>
    <text class="system-art-label" x="0" y="68" text-anchor="middle">${escape(shortLabels[stage.id] || stage.title)}</text>
  </g>`).join('');
  return `<svg class="system-art" viewBox="0 0 720 370" role="img" aria-label="Conceptual oil system: export availability, passage and freight, security and insurance, and oil benchmarks. Select a part using the diagram or the numbered controls. The drawing is not live flow, a map, or a price forecast.">
    <path class="system-art-guide" d="M56 294 368 150 665 12M55 308 367 164 665 26"/>
    <path class="system-art-connector" d="M135 188 285 250 435 188 585 126"/>
    <g class="system-art-anchors"><circle cx="135" cy="188" r="3"/><circle cx="285" cy="250" r="3"/><circle cx="435" cy="188" r="3"/><circle cx="585" cy="126" r="3"/></g>
    ${parts}
  </svg>`;
}
