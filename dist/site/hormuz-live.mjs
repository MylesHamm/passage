// The live Hormuz map with its card, shared by the overview and Hormuz pages.
// A tapped vessel, gap or event opens the card on the map; an event's card
// links to that event's own page.
import { createHeroMap } from '../ops/hero-map.mjs';
import { vesselCardMarkup, eventCardMarkup, eventGroupMarkup, gapCardMarkup } from '../ops/panels.mjs';
import { located } from '../ops/events.mjs';
import { eventHref } from './data.mjs';

export async function mountHormuzMap(root, card) {
  let map = null, events = [], showing = null;
  const show = (kind, html) => {
    showing = html ? kind : null;
    card.classList.toggle('event-card', kind !== 'vessel');
    card.innerHTML = html || ''; card.hidden = !html;
  };
  const clear = () => { map?.select(null); map?.selectEvent(null); map?.clearGap(); show(null, ''); };
  function openEvent(id) {
    const event = events.find(e => e.id === id);
    if (!event) return;
    map?.select(null); map?.clearGap(); map?.selectEvent(id);
    show('event', eventCardMarkup(event, { href: eventHref(event), moves: false }));
  }
  card.addEventListener('click', event => {
    if (event.target.closest('[data-close-vessel], [data-close-event], [data-close-gap]')) clear();
  });
  try {
    map = await createHeroMap(root, {
      onSelect: vessel => {
        if (vessel) { map?.selectEvent(null); map?.clearGap(); show('vessel', vesselCardMarkup(vessel)); }
        else if (showing === 'vessel') show(null, '');
      },
      onEventSelect: event => event ? openEvent(event.id) : show(null, ''),
      onEventGroup: list => { map?.select(null); map?.clearGap(); show('group', eventGroupMarkup(list, { href: eventHref })); },
      onGapSelect: (item, kind) => { map?.select(null); map?.selectEvent(null); show('gap', item ? gapCardMarkup(item, kind) : ''); },
    });
  } catch {
    root.insertAdjacentHTML('beforeend', '<p class="map-fallback">The 3D map could not load on this device. The figures on this page still update.</p>');
    return null;
  }
  return {
    map,
    setVessels(data) { map.setVessels(data?.vessels || []); map.setGaps(data?.gaps || null); },
    setEvents(list) { events = located(list); map.setEvents(events); },
    /** Opens one ship that is dark now, from the AIS gaps card. */
    showGap(item) { if (!item) return; map.select(null); map.selectEvent(null); map.selectGap(item.mmsi); show('gap', gapCardMarkup(item, 'dark')); },
    clear,
  };
}
