/**
 * Keep each email link the color we chose, inside Buttondown's template.
 *
 * Buttondown wraps every email in its own stylesheet, which contains
 *
 *     a       { color: #0069FF !important; }
 *     a > *   { color: inherit !important; }
 *
 * and inlines those rules over ours. So every link in every edition arrived
 * bright blue: the "My Town News" wordmark on navy (with "News" inheriting
 * the blue through `a > *`), "See the full edition", the navy-on-gold "Open
 * the full edition" button, every "Read the full story" and "Verify" link,
 * and the footer. Found by reading the 16 October issue as it arrived in
 * Gmail; the HTML we sent had the right colors.
 *
 * Both rules stop at the link and its direct children. So each link's text
 * is wrapped twice: the outer span is the direct child Buttondown sets to
 * inherit, and the inner span carries the link's own color, which no rule in
 * that stylesheet reaches. Spans already inside the link (the gold "News")
 * sit deeper still and keep their own colors.
 *
 * A link without a color in its style is left alone. Pure string transform.
 */

"use strict";

const LINK = /<a\b([^>]*\bstyle="([^"]*)"[^>]*)>([\s\S]*?)<\/a>/gi;

function linkColor(style) {
  const m = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(style);
  return m ? m[1].trim() : null;
}

function pinLinkColors(html) {
  return String(html).replace(LINK, (whole, attrs, style, inner) => {
    const color = linkColor(style);
    if (!color || /data-pinned/.test(attrs)) return whole;
    return `<a${attrs} data-pinned="1"><span><span style="color:${color};">${inner}</span></span></a>`;
  });
}

module.exports = { pinLinkColors, linkColor };
