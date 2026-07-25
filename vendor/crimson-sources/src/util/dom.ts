/*
 * HTML parsing for the discovery sources.
 *
 * The backend scrapers use selectolax; in the browser the native `DOMParser`
 * gives us the same CSS-selector access (`querySelectorAll`, attribute reads)
 * with no dependency. This is the only module that touches the DOM API, so the
 * sources stay testable against a small surface.
 */

export interface ParsedDoc {
  /** All elements matching a CSS selector. */
  all(selector: string): Element[];
  /** First element matching a CSS selector, or null. */
  first(selector: string): Element | null;
}

/** Parse an HTML string into a queryable document. */
export function parseHtml(html: string): ParsedDoc {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return {
    all: (selector) => Array.from(doc.querySelectorAll(selector)),
    first: (selector) => doc.querySelector(selector),
  };
}

/** Trimmed text content of an element (selectolax `.text(strip=True)`). */
export function elText(el: Element | null): string {
  return (el?.textContent ?? "").trim();
}

/** An element attribute, or "" when absent. */
export function attr(el: Element, name: string): string {
  return el.getAttribute(name) ?? "";
}
