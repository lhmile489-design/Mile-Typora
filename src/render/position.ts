// Where the reader left off (PRD FR-07.3, FR-08.5): a heading and the offset
// below it, plus the overall ratio as a fallback for documents that changed.

/** A reading position, as kept per window and per file. */
export type Position = {
  /** Id of the last heading above the viewport, or null before the first. */
  anchor: string | null;
  /** Distance below that heading, in pixels. */
  offset: number;
  /** Scroll position as a share of what can be scrolled, 0 to 1. */
  ratio: number;
};

/** Metrics of a document, taken from its scroller. */
export type Metrics = {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  /** Headings with an id, with their distance from the top of the content. */
  headings: { id: string; top: number }[];
};

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

/** capture records where the reader is. */
export function capture(metrics: Metrics): Position {
  const max = Math.max(1, metrics.scrollHeight - metrics.clientHeight);
  const ratio = clamp(metrics.scrollTop / max, 0, 1);
  let anchor: string | null = null;
  let anchorTop = 0;
  for (const heading of metrics.headings) {
    if (heading.top > metrics.scrollTop + 1) break;
    anchor = heading.id;
    anchorTop = heading.top;
  }
  return { anchor, offset: anchor ? metrics.scrollTop - anchorTop : 0, ratio };
}

/** restore returns the scroll offset a position means in this document. */
export function restore(metrics: Metrics, position: Position): number {
  const max = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
  if (position.anchor) {
    const heading = metrics.headings.find((h) => h.id === position.anchor);
    if (heading) return clamp(heading.top + position.offset, 0, max);
  }
  // The heading is gone, or there never was one: fall back to the ratio.
  return clamp(position.ratio * max, 0, max);
}

/** metricsOf reads the scroller and the headings of a rendered document. */
export function metricsOf(scroller: HTMLElement): Metrics {
  const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
  const headings: Metrics["headings"] = [];
  for (const element of scroller.querySelectorAll<HTMLElement>("h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]")) {
    if (!element.id) continue;
    headings.push({ id: element.id, top: element.getBoundingClientRect().top - base });
  }
  return {
    scrollTop: scroller.scrollTop,
    clientHeight: scroller.clientHeight,
    scrollHeight: scroller.scrollHeight,
    headings,
  };
}
