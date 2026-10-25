// Advisory checks on curated events: things a reviewer should look at, not
// rule breaks. A headline can legitimately carry a figure the summary leaves
// out (a headline covering several incidents, or a body that updates the
// toll), so these warn rather than fail.
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };
const NUMBER = `\\d+|${Object.keys(WORDS).join('|')}`;
// "13 killed", "13 killed, injured", "at least 180 wounded", "Six killed".
const CASUALTY = new RegExp(`\\b(${NUMBER})\\s+(?:people\\s+|civilians\\s+|crew\\s+(?:members\\s+)?)?(?:killed|dead|died|wounded|injured|hurt|casualties)\\b`, 'gi');
const value = token => WORDS[token.toLowerCase()] ?? Number(token);

/** Casualty figures in a piece of text, as numbers. */
export const casualtyFigures = text => [...String(text ?? '').matchAll(CASUALTY)].map(m => value(m[1]));
const mentions = (text, n) => new RegExp(`\\b${n}\\b`).test(text) || Object.entries(WORDS).some(([word, v]) => v === n && new RegExp(`\\b${word}\\b`, 'i').test(text));

/**
 * Sources whose headline gives a casualty figure that the event's title and
 * summary never mention. Each needs a look: if the article's body gives a
 * different (often later) figure, the summary should say who gave which.
 */
export function figureWarnings(event) {
  const text = `${event?.title ?? ''} ${event?.summary ?? ''}`;
  return (Array.isArray(event?.sources) ? event.sources : []).flatMap(source => {
    const missing = [...new Set(casualtyFigures(source?.title))].filter(n => !mentions(text, n));
    return missing.length ? [{ id: event.id, publisher: source.publisher, title: source.title, missing }] : [];
  });
}
