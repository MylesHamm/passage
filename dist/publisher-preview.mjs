// Display-only cleanup of retained feed excerpts. Never insert provider markup.
// Old archived excerpts can contain escaped or truncated HTML; do not display it as prose.
export function publisherPreview(value) {
  if (typeof value !== 'string') return '';
  let text = value;
  const entities = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ' };
  for (let pass = 0; pass < 2; pass++) {
    text = text.replace(/&(lt|gt|amp|quot|apos|nbsp);/gi, (_, key) => entities[key.toLowerCase()])
      .replace(/&#(x[\da-f]+|\d+);/gi, (_, key) => {
        const code = key[0].toLowerCase() === 'x' ? parseInt(key.slice(1), 16) : Number(key);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
      });
  }
  return text.replace(/<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1>|$)/gi, '')
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/<\/?[a-z!][^>]*>/gi, ' ')
    .replace(/<\/?[a-z!][^>]*$/gi, '')
    .replace(/\s+/g, ' ').trim();
}
