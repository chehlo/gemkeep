// Pixel-level visibility verification for browser tests.
//
// Reads the ACTUAL rendered pixels the user sees, via page.screenshot().
// This is the only way to verify visibility that accounts for the browser's
// paint + composite + clip pipeline — CSS-property reads (getComputedStyle)
// only see configuration, not pixels.
//
// Contract: call `assertColorVisibleInElementArea(el, color)` to verify that
// SOMEWHERE in the element's decoration area (perimeter + a margin around
// the border-box), at least one pixel matches the expected color.
//
// When the visual design changes (border → outline → badge-dot), this
// helper needs no changes — it sampled rendered pixels, agnostic of which
// CSS channel drew them.

import { page } from '@vitest/browser/context'
import { expect } from 'vitest'

// Default margin is small so we stay inside the element's own "decoration
// territory" and don't sample pixels from neighbouring cards/panels.
// StackOverview/StackFocus grids use gap-3 (12px); a 3px margin stays
// comfortably within each cell and still captures a 2px-wide outline or
// border at the element's edge.
// Must capture both indicator layers: outer border at 0-2px from edge,
// inner border at 2-4px from edge. 6px inner margin covers both.
const DEFAULT_MARGIN_PX = 6
const DEFAULT_COLOR_TOLERANCE = 3

type RGB = { r: number; g: number; b: number }

function parseRgbString(s: string): RGB | null {
  const m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (!m) return null
  return { r: parseInt(m[1]), g: parseInt(m[2]), b: parseInt(m[3]) }
}

async function decodeBase64Png(base64: string): Promise<ImageData> {
  // strip data URL prefix if present (e.g. "data:image/png;base64,...")
  const clean = base64.replace(/^data:[^;]+;base64,/, '')
  const bytes = Uint8Array.from(atob(clean), c => c.charCodeAt(0))
  const blob = new Blob([bytes], { type: 'image/png' })
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0)
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height)
}

/**
 * Capture the pixels in a rectangle around an element — the element itself
 * plus a margin on all sides. The margin captures outline/shadow pixels
 * that draw outside the element's border-box.
 */
async function captureElementAreaPixels(
  el: HTMLElement, marginPx: number,
): Promise<{ pixels: ImageData; margin: number }> {
  // vitest-browser's `page.screenshot({ element })` screenshots just that
  // element. But it clips to the element's border-box, missing outline
  // pixels that draw outside. So we screenshot the VIEWPORT and crop
  // ourselves using getBoundingClientRect + margin.
  // page.screenshot with base64:true + save:false returns a base64 string
  const result = await page.screenshot({ base64: true, save: false }) as unknown as string
  const fullImage = await decodeBase64Png(result)

  // Match the screenshot's resolution to CSS-pixel coordinates from
  // getBoundingClientRect — Playwright's screenshot in test mode is at
  // CSS-pixel size (no DPR scaling applied by the capture).
  const rect = el.getBoundingClientRect()
  const scale = fullImage.width / window.innerWidth

  const cropX = Math.max(0, Math.floor((rect.left - marginPx) * scale))
  const cropY = Math.max(0, Math.floor((rect.top - marginPx) * scale))
  const cropW = Math.min(
    fullImage.width - cropX,
    Math.ceil((rect.width + 2 * marginPx) * scale),
  )
  const cropH = Math.min(
    fullImage.height - cropY,
    Math.ceil((rect.height + 2 * marginPx) * scale),
  )

  const canvas = document.createElement('canvas')
  canvas.width = cropW
  canvas.height = cropH
  const ctx = canvas.getContext('2d')!
  const tmpCanvas = document.createElement('canvas')
  tmpCanvas.width = fullImage.width
  tmpCanvas.height = fullImage.height
  tmpCanvas.getContext('2d')!.putImageData(fullImage, 0, 0)
  ctx.drawImage(tmpCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH)

  return {
    pixels: ctx.getImageData(0, 0, cropW, cropH),
    margin: marginPx * scale,
  }
}

function colorsMatch(a: RGB, b: RGB, tolerance: number): boolean {
  return Math.abs(a.r - b.r) <= tolerance
    && Math.abs(a.g - b.g) <= tolerance
    && Math.abs(a.b - b.b) <= tolerance
}

/**
 * Scan an ImageData for the expected color. Only considers pixels in the
 * decoration ring — the outer `margin` pixels and the inner ~`margin` pixels
 * near the border-box edge, ignoring the content area. This avoids false
 * positives from photo content that happens to contain the expected color.
 */
function countMatchingPixels(
  img: ImageData, expected: RGB, tolerance: number, marginPx: number,
): number {
  const { width: w, height: h, data } = img
  let count = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Is this pixel in the decoration ring?
      const inOuterMargin = x < marginPx || y < marginPx
        || x >= w - marginPx || y >= h - marginPx
      const inInnerRing = (x >= marginPx && x < 2 * marginPx)
        || (y >= marginPx && y < 2 * marginPx)
        || (x >= w - 2 * marginPx && x < w - marginPx)
        || (y >= h - 2 * marginPx && y < h - marginPx)
      if (!inOuterMargin && !inInnerRing) continue

      const i = (y * w + x) * 4
      const p: RGB = { r: data[i], g: data[i + 1], b: data[i + 2] }
      if (colorsMatch(p, expected, tolerance)) count++
    }
  }
  return count
}

/**
 * Sample the most-common colors in the decoration ring, for diagnostic
 * failure messages.
 */
function topColorsInRing(img: ImageData, marginPx: number, topN: number): string[] {
  const counts = new Map<string, number>()
  const { width: w, height: h, data } = img
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inOuterMargin = x < marginPx || y < marginPx
        || x >= w - marginPx || y >= h - marginPx
      const inInnerRing = (x >= marginPx && x < 2 * marginPx)
        || (y >= marginPx && y < 2 * marginPx)
        || (x >= w - 2 * marginPx && x < w - marginPx)
        || (y >= h - 2 * marginPx && y < h - marginPx)
      if (!inOuterMargin && !inInnerRing) continue
      const i = (y * w + x) * 4
      // Quantize to nearest 4 to reduce noise
      const q = (v: number) => (v >> 2) << 2
      const key = `rgb(${q(data[i])}, ${q(data[i + 1])}, ${q(data[i + 2])})`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([k, v]) => `${k}×${v}`)
}

/**
 * Check which sides of the decoration ring contain matching pixels.
 * A visible indicator (frame) must appear on at least 2 perpendicular
 * sides — not just one edge (which would be a leaked sliver, not a frame).
 */
function sidesWithColor(
  img: ImageData, expected: RGB, tolerance: number, marginPx: number,
): { top: boolean; right: boolean; bottom: boolean; left: boolean; count: number; total: number } {
  const { width: w, height: h, data } = img
  const midX = w / 2
  const midY = h / 2
  const sides = { top: false, right: false, bottom: false, left: false }
  let total = 0
  // "Side" = the edge strip of the decoration ring, not a half-plane.
  // Round margin to integer and add 2px tolerance to strip width to handle
  // subpixel rendering when screenshot resolution ≠ CSS pixels (scale ≠ 1).
  // Without tolerance, borders at fractional positions can land 1px outside
  // the strip boundary.
  const m = Math.round(marginPx)
  const stripW = 2 * m + 2

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inOuter = x < m || y < m || x >= w - m || y >= h - m
      const inInner = (x >= m && x < 2 * m)
        || (y >= m && y < 2 * m)
        || (x >= w - 2 * m && x < w - m)
        || (y >= h - 2 * m && y < h - m)
      if (!inOuter && !inInner) continue

      const i = (y * w + x) * 4
      const p: RGB = { r: data[i], g: data[i + 1], b: data[i + 2] }
      if (!colorsMatch(p, expected, tolerance)) continue

      total++
      // Assign to side based on which edge STRIP the pixel is in
      if (y < stripW) sides.top = true
      if (y >= h - stripW) sides.bottom = true
      if (x < stripW) sides.left = true
      if (x >= w - stripW) sides.right = true
    }
  }

  const count = [sides.top, sides.right, sides.bottom, sides.left].filter(Boolean).length
  return { ...sides, count, total }
}

/**
 * Assert that the expected color forms a visible indicator FRAME on the
 * element — not just a thin leaked line on one edge.
 *
 * Requirements:
 *   1. At least `minPixels` matching pixels exist in the decoration ring.
 *   2. Matching pixels appear on BOTH axes (at least one horizontal side
 *      AND at least one vertical side). A sliver on only one edge fails.
 */
export async function assertColorVisibleInElementArea(
  el: HTMLElement,
  expectedColor: string,
  options: { marginPx?: number; tolerance?: number; minPixels?: number } = {},
) {
  const marginPx = options.marginPx ?? DEFAULT_MARGIN_PX
  const tolerance = options.tolerance ?? DEFAULT_COLOR_TOLERANCE
  const minPixels = options.minPixels ?? 4

  const expected = parseRgbString(expectedColor)
  if (!expected) throw new Error(`Invalid color: ${expectedColor}`)

  const { pixels, margin } = await captureElementAreaPixels(el, marginPx)
  const sides = sidesWithColor(pixels, expected, tolerance, margin)

  // Dynamic minimum: a visible 2px indicator frame on this element produces
  // roughly perimeter * indicatorWidth pixels. Require at least 5% of that
  // so a one-edge sliver (~6 pixels) can't sneak past while a real frame
  // (~2000+ pixels) easily clears. Floor at the caller's minPixels.
  const rect = el.getBoundingClientRect()
  const perimeter = 2 * (rect.width + rect.height)
  const dynamicMin = Math.max(minPixels, Math.floor(perimeter * 0.05))

  if (sides.total < dynamicMin) {
    const topColors = topColorsInRing(pixels, margin, 5)
    expect.fail(
      `expected ${expectedColor} to be visible in the element's decoration area, `
      + `but found only ${sides.total} matching pixels (min ${dynamicMin} required, based on ${Math.round(perimeter)}px perimeter). `
      + `Top colors in decoration ring: ${topColors.join(', ')}`,
    )
  }

  // A visible indicator FRAME must appear on ALL 4 sides of the element.
  // If any side is missing, the indicator is partially clipped, covered by
  // a sibling, or only rendering as a leaked sliver — not a visible frame.
  const missingSides = (['top', 'right', 'bottom', 'left'] as const)
    .filter(s => !sides[s])
  if (missingSides.length > 0) {
    const presentSides = (['top', 'right', 'bottom', 'left'] as const)
      .filter(s => sides[s])
    expect.fail(
      `${expectedColor} found ${sides.total} pixels but missing on ${missingSides.join(', ')} side(s) `
      + `(present on: ${presentSides.join(', ') || 'none'}). `
      + `A visible frame must surround the element on all 4 sides.`,
    )
  }
}

/**
 * Assert that NO pixels in the element's decoration area match the color.
 * Uses zero outer margin (samples only INSIDE the element) to avoid picking
 * up the adjacent element's border pixels that bleed into the outer margin.
 */
export async function assertColorNotVisibleInElementArea(
  el: HTMLElement,
  expectedColor: string,
  options: { marginPx?: number; tolerance?: number; maxPixels?: number } = {},
) {
  const marginPx = options.marginPx ?? 0
  const tolerance = options.tolerance ?? DEFAULT_COLOR_TOLERANCE
  const maxPixels = options.maxPixels ?? 4

  const expected = parseRgbString(expectedColor)
  if (!expected) throw new Error(`Invalid color: ${expectedColor}`)

  const { pixels, margin } = await captureElementAreaPixels(el, marginPx)
  const matches = countMatchingPixels(pixels, expected, tolerance, margin)

  if (matches <= maxPixels) return
  const topColors = topColorsInRing(pixels, margin, 5)
  expect.fail(
    `expected ${expectedColor} to NOT be visible in the element's decoration area, `
    + `but found ${matches} matching pixels (max ${maxPixels} allowed). `
    + `Top colors: ${topColors.join(', ')}`,
  )
}
