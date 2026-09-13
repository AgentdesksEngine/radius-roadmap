/**
 * Markdown (and the stray HTML that Slack-imported bodies carry) flattened to a plain
 * sentence, for previews where the markup is noise rather than content.
 */
export function plainText(src: string): string {
  return src
    .replace(/```[\s\S]*?```/g, ' ') // fenced code
    .replace(/`([^`]*)`/g, '$1') // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links -> their text
    .replace(/<\/?[a-z][^>]*>/gi, ' ') // html tags
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // headings
    .replace(/^\s{0,3}>\s?/gm, '') // blockquotes
    .replace(/^\s{0,3}([-*+]|\d+\.)\s+/gm, '') // list markers
    .replace(/^\s*\|.*\|\s*$/gm, ' ') // table rows
    .replace(/^\s*[-:|\s]+$/gm, ' ') // table rules and hr
    .replace(/(\*\*|__|\*|_|~~)/g, '') // emphasis
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Plain text cut to `max`, on a word boundary, with an ellipsis when something was dropped. */
export function excerpt(src: string, max = 260): string {
  const text = plainText(src);
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.–-]+$/, '')}…`;
}
