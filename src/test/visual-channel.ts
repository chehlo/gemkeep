// Marker-class resolution and diagnostic helpers.
//
// Pixel visibility verification now lives in `pixel-verifier.ts` — this
// module only provides the small helper to find the marker-carrying
// element when tests pass a card/frame/panel wrapper instead of the
// marker element itself.

/**
 * Resolve an element to the target carrying a given marker class:
 * returns `el` itself if it matches, otherwise the first descendant.
 * Returns null if no element matches.
 *
 * This lets helpers accept any level of the visual hierarchy (card, frame,
 * panel, or the marker element itself) without the caller knowing where
 * the marker lives.
 */
export function resolveMarker(el: HTMLElement, selector: string): HTMLElement | null {
  if (el.matches(selector)) return el
  return el.querySelector(selector) as HTMLElement | null
}
