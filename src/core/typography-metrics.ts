/**
 * Typographic metric parsing, scaling, and extraction utilities.
 *
 * Provides pure functions for resolving letter spacing (tracking), word spacing,
 * line height (leading), horizontal scaling, and baseline vertical alignment so
 * that inline PDF editors and canvas text elements maintain visual parity with
 * native PDFium content streams across zoom levels and mutations.
 */

import { calculateTextWidth } from './pdfium-helpers';
import type { TextLine, TextWord } from './types';

/**
 * Parses a letter spacing specification into PDF points relative to a given font size.
 *
 * Supports numeric values, point strings ('1.5pt'), pixel strings ('2px'),
 * em units ('0.1em'), and percentage strings ('5%').
 *
 * @param letterSpacing Raw letter spacing string or numeric point value.
 * @param fontSize Reference font size in points.
 * @return Resolved letter spacing in PDF points, or 0 if normal/empty/invalid.
 */
export function parseLetterSpacingToPoints(
  letterSpacing: string | number | undefined | null,
  fontSize: number
): number {
  if (letterSpacing === undefined || letterSpacing === null) return 0;
  if (typeof letterSpacing === 'number') {
    return Number.isFinite(letterSpacing) ? letterSpacing : 0;
  }

  const trimmed = letterSpacing.trim().toLowerCase();
  if (!trimmed || trimmed === 'normal') return 0;

  const num = parseFloat(trimmed);
  if (!Number.isFinite(num)) return 0;

  if (trimmed.endsWith('%')) {
    return (num / 100) * fontSize;
  }
  if (trimmed.endsWith('em') || trimmed.endsWith('rem')) {
    return num * fontSize;
  }
  return num;
}

/**
 * Formats a numeric point letter spacing value into a canonical string representation.
 *
 * @param points Letter spacing in PDF points.
 * @return Canonical point string (e.g. '1.25pt') or undefined when negligible.
 */
export function formatLetterSpacingPoints(points: number | undefined | null): string | undefined {
  if (points === undefined || points === null || !Number.isFinite(points)) {
    return undefined;
  }
  const rounded = Math.round(points * 100) / 100;
  if (Math.abs(rounded) < 0.15) {
    return undefined;
  }
  return `${rounded}pt`;
}

/**
 * Formats a letter spacing specification into a zoom-scaled CSS `letter-spacing` value.
 *
 * Relative units (`em`, `rem`) and percentages (`%` converted to `em`) scale naturally
 * with the element's zoom-scaled `font-size`, whereas absolute values (`pt`, `px`, or
 * bare numbers) are multiplied by the active viewport zoom factor.
 *
 * @param letterSpacing Raw letter spacing string or numeric point value.
 * @param fontSize Reference unscaled font size in points.
 * @param zoom Active viewport zoom factor.
 * @return Valid CSS `letter-spacing` property string (e.g. `'2.40px'`, `'0.0500em'`, or `'normal'`).
 */
export function formatScaledCssLetterSpacing(
  letterSpacing: string | number | undefined | null,
  fontSize: number,
  zoom: number = 1
): string {
  if (letterSpacing === undefined || letterSpacing === null) return 'normal';
  if (typeof letterSpacing === 'number') {
    if (!Number.isFinite(letterSpacing) || Math.abs(letterSpacing) < 0.15) return 'normal';
    return `${(letterSpacing * zoom).toFixed(2)}px`;
  }

  const trimmed = letterSpacing.trim().toLowerCase();
  if (!trimmed || trimmed === 'normal') return 'normal';

  const num = parseFloat(trimmed);
  if (!Number.isFinite(num) || Math.abs(num) < 0.001) return 'normal';

  if (trimmed.endsWith('%')) {
    return `${(num / 100).toFixed(4)}em`;
  }
  if (trimmed.endsWith('em') || trimmed.endsWith('rem')) {
    return trimmed;
  }
  const pts = parseLetterSpacingToPoints(trimmed, fontSize);
  if (Math.abs(pts) < 0.15) return 'normal';
  return `${(pts * zoom).toFixed(2)}px`;
}

/**
 * Formats an extra word spacing delta (in PDF points) into a zoom-scaled CSS `word-spacing` value.
 *
 * @param wordSpacingPts Extra inter-word spacing in PDF points.
 * @param zoom Active viewport zoom factor.
 * @return Valid CSS `word-spacing` value (e.g. `'1.80px'` or `'normal'`).
 */
export function formatScaledCssWordSpacing(
  wordSpacingPts: number | undefined | null,
  zoom: number = 1
): string {
  if (
    wordSpacingPts === undefined ||
    wordSpacingPts === null ||
    !Number.isFinite(wordSpacingPts) ||
    Math.abs(wordSpacingPts) < 0.05
  ) {
    return 'normal';
  }
  return `${(wordSpacingPts * zoom).toFixed(2)}px`;
}

/**
 * Scales a letter spacing specification proportionally when a page or element is scaled.
 *
 * Relative specifications (`em`, `rem`, `%`) remain unchanged because they scale
 * automatically with the scaled `fontSize`; point/pixel specifications scale by `scaleFactor`.
 *
 * @param letterSpacing Raw letter spacing string.
 * @param scaleFactor Horizontal/proportional scale factor.
 * @return Scaled letter spacing string, or undefined if input is empty.
 */
export function scaleLetterSpacingValue(
  letterSpacing: string | undefined,
  scaleFactor: number
): string | undefined {
  if (!letterSpacing) return letterSpacing;
  const trimmed = letterSpacing.trim();
  const lower = trimmed.toLowerCase();
  if (!lower || lower === 'normal') return letterSpacing;
  if (lower.endsWith('%') || lower.endsWith('em') || lower.endsWith('rem')) {
    return trimmed;
  }
  const num = parseFloat(lower);
  if (!Number.isFinite(num)) return trimmed;
  const scaled = Math.round(num * scaleFactor * 100) / 100;
  if (lower.endsWith('px')) return `${scaled}px`;
  return `${scaled}pt`;
}

/**
 * Calculates text width in PDF points including character tracking (letter spacing)
 * and optional inter-word spacing overrides.
 *
 * @param text The text string to measure.
 * @param fontSize Font size in points.
 * @param fontFamily Font family name.
 * @param letterSpacing Optional letter spacing specification or point value.
 * @param wordSpacingPts Optional extra word spacing in points per space character.
 * @return Total advance width in PDF points.
 */
export function calculateTrackedTextWidth(
  text: string,
  fontSize: number,
  fontFamily: string,
  letterSpacing?: string | number,
  wordSpacingPts?: number
): number {
  if (!text) return 0;
  const baseWidth = calculateTextWidth(text, fontSize, fontFamily);
  const trackingPts = parseLetterSpacingToPoints(letterSpacing, fontSize);
  const trackingTotal = text.length > 1 ? (text.length - 1) * trackingPts : 0;

  let extraWordSpaceTotal = 0;
  if (wordSpacingPts && Number.isFinite(wordSpacingPts) && Math.abs(wordSpacingPts) > 0.01) {
    let spaceCount = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === ' ') spaceCount++;
    }
    extraWordSpaceTotal = spaceCount * wordSpacingPts;
  }

  return Math.max(0, baseWidth + trackingTotal + extraWordSpaceTotal);
}

/**
 * Estimates empirical character tracking (in PDF points) for a word from its extracted
 * character origin advances and standard font glyph advance table.
 *
 * @param text Sanitised word text.
 * @param charOriginsX Ordered array of character origin X coordinates in DOM/PDF points.
 * @param wordWidth Total bounding box width of the word in points.
 * @param fontSize Word font size in points.
 * @param fontFamily Word font family name.
 * @param isBold Optional flag indicating whether the word uses bold weight.
 * @return Estimated per-character tracking in PDF points, bounded to typographic limits.
 */
export function estimateWordTrackingPoints(
  text: string,
  charOriginsX: readonly number[],
  wordWidth: number,
  fontSize: number,
  fontFamily: string,
  isBold?: boolean
): number {
  if (!text || text.length < 2 || fontSize <= 0) return 0;

  const fontLower = (fontFamily || '').toLowerCase();
  const isMonospace =
    fontLower.includes('courier') ||
    fontLower.includes('mono') ||
    fontLower.includes('consol') ||
    fontLower.includes('typewriter') ||
    fontLower.startsWith('cmtt') ||
    fontLower.startsWith('lmtt') ||
    fontLower.startsWith('pcr');
  const effectiveBold =
    !isMonospace &&
    (isBold ??
      (fontLower.includes('bold') ||
        fontLower.includes('black') ||
        fontLower.includes('heavy') ||
        fontLower.includes('semibold') ||
        fontLower.includes('demibold')));
  const weightMultiplier = effectiveBold ? 1.06 : 1.0;

  const unspacedWidth = calculateTextWidth(text, fontSize, fontFamily) * weightMultiplier;
  if (unspacedWidth <= 0) return 0;

  // Prefer origin-to-origin step residuals when character origins match character count
  if (charOriginsX.length === text.length) {
    const stepCount = text.length - 1;
    const residuals: number[] = [];
    let validSteps = true;

    for (let i = 0; i < stepCount; i++) {
      const stepAdvance = charOriginsX[i + 1] - charOriginsX[i];
      if (!Number.isFinite(stepAdvance) || stepAdvance <= 0) {
        validSteps = false;
        break;
      }
      const expectedCharAdvance =
        calculateTextWidth(text[i], fontSize, fontFamily) * weightMultiplier;
      residuals.push(stepAdvance - expectedCharAdvance);
    }

    if (validSteps && residuals.length === stepCount) {
      const sumResiduals = residuals.reduce((acc, r) => acc + r, 0);
      const rawTracking = sumResiduals / stepCount;
      const sign = Math.sign(rawTracking);
      if (sign === 0) return 0;

      // Check step uniformity: genuine PDF character tracking applies a constant offset
      // across all character pairs, whereas proportional font metric differences vary per glyph.
      // At least two character transitions are required to establish uniformity.
      let maxDeviation = 0;
      let consistentSignCount = 0;
      for (const r of residuals) {
        const dev = Math.abs(r - rawTracking);
        if (dev > maxDeviation) maxDeviation = dev;
        if (Math.sign(r) === sign && Math.abs(r) >= Math.abs(rawTracking) * 0.35) {
          consistentSignCount++;
        }
      }

      const isUniformTracking =
        stepCount >= 2 &&
        maxDeviation <= Math.max(0.15, fontSize * 0.025) &&
        consistentSignCount === stepCount;
      const minThreshold = isUniformTracking
        ? Math.max(0.25, fontSize * 0.035)
        : stepCount === 1
          ? Math.max(0.6, fontSize * 0.09)
          : Math.max(0.45, fontSize * 0.065);

      if (Math.abs(rawTracking) < minThreshold || consistentSignCount < Math.ceil(stepCount * 0.75)) {
        return 0;
      }

      return Math.max(
        -fontSize * 0.25,
        Math.min(fontSize * 1.0, Math.round(rawTracking * 100) / 100)
      );
    }
  }

  const rawDiff = (wordWidth - unspacedWidth) / (text.length - 1);
  if (Math.abs(rawDiff) < Math.max(0.5, fontSize * 0.075)) return 0;
  return Math.max(-fontSize * 0.25, Math.min(fontSize * 1.0, Math.round(rawDiff * 100) / 100));
}

/**
 * Computes empirical line-level typographic metrics (dominant letter spacing, extra word spacing,
 * and horizontal scale factor) from the assembled words on a line.
 *
 * @param words Ordered words belonging to the line.
 * @param lineFontSize Dominant font size of the line in points.
 * @param lineFontFamily Dominant font family of the line.
 * @return Calibrated letterSpacing string, numeric letterSpacingPts, extra wordSpacingPts, and scaleX.
 */
export function computeLineTypographicMetrics(
  words: readonly TextWord[],
  lineFontSize: number,
  lineFontFamily: string
): {
  letterSpacing?: string;
  letterSpacingPts: number;
  wordSpacing?: number;
  scaleX: number;
} {
  if (!words || words.length === 0) {
    return { letterSpacingPts: 0, scaleX: 1 };
  }

  let weightedTrackingSum = 0;
  let trackingWeightTotal = 0;

  for (const w of words) {
    const pairs = Math.max(0, w.text.length - 1);
    if (pairs > 0) {
      const wTrack =
        w.letterSpacingPts !== undefined
          ? w.letterSpacingPts
          : parseLetterSpacingToPoints(w.letterSpacing, w.fontSize || lineFontSize);
      weightedTrackingSum += wTrack * pairs;
      trackingWeightTotal += pairs;
    }
  }

  const avgTrackingPts =
    trackingWeightTotal > 0
      ? Math.round((weightedTrackingSum / trackingWeightTotal) * 100) / 100
      : 0;
  const letterSpacing = formatLetterSpacingPoints(avgTrackingPts);
  const resolvedTrackingPts = letterSpacing ? avgTrackingPts : 0;

  let wordSpacing: number | undefined = undefined;
  if (words.length > 1) {
    const spaceResiduals: number[] = [];
    for (let i = 1; i < words.length; i++) {
      const prev = words[i - 1];
      const curr = words[i];
      const gap = curr.left - prev.right;
      if (
        (curr.hasPrecedingSpace || gap >= Math.min(prev.fontSize, curr.fontSize) * 0.12) &&
        gap <= lineFontSize * 1.8
      ) {
        const prevFs = prev.fontSize || lineFontSize;
        const prevFont = prev.fontFamily || prev.rawFontFamily || lineFontFamily;
        const prevFontLower = prevFont.toLowerCase();
        const prevIsMono =
          prevFontLower.includes('courier') ||
          prevFontLower.includes('mono') ||
          prevFontLower.includes('consol') ||
          prevFontLower.includes('typewriter') ||
          prevFontLower.startsWith('cmtt') ||
          prevFontLower.startsWith('lmtt') ||
          prevFontLower.startsWith('pcr');
        const prevIsBold =
          !prevIsMono &&
          (prev.fontWeight === 'bold' ||
            prevFontLower.includes('bold') ||
            prevFontLower.includes('black') ||
            prevFontLower.includes('heavy') ||
            prevFontLower.includes('semibold') ||
            prevFontLower.includes('demibold'));
        const prevWeightMult = prevIsBold ? 1.06 : 1.0;
        const prevTrackPts =
          prev.letterSpacingPts !== undefined
            ? prev.letterSpacingPts
            : parseLetterSpacingToPoints(prev.letterSpacing, prevFs);
        // Use the larger of the tight ink box width (plus outer glyph side-bearings when the actual font
        // is wider than the standard advance table) and the full typographic advance width.
        const basePrevAdvance = calculateTrackedTextWidth(prev.text, prevFs, prevFont, prevTrackPts, 0);
        const inkBoxAdvance =
          prev.width > basePrevAdvance + prevFs * 0.03 ? prev.width + prevFs * 0.1 : prev.width;
        const expectedPrevAdvance = Math.max(inkBoxAdvance, basePrevAdvance * prevWeightMult);
        const actualWordStep = curr.left - prev.left;
        const effectiveSpaceWidth = actualWordStep - expectedPrevAdvance;
        const stdSpace = calculateTextWidth(' ', curr.fontSize || lineFontSize, curr.fontFamily || lineFontFamily);
        spaceResiduals.push(effectiveSpaceWidth - stdSpace);
      }
    }
    if (spaceResiduals.length > 0) {
      const gapSum = spaceResiduals.reduce((acc, r) => acc + r, 0);
      const avgExtraSpace = Math.round((gapSum / spaceResiduals.length) * 100) / 100;
      const spaceSign = Math.sign(avgExtraSpace);
      const consistentSpaceCount = spaceResiduals.filter(
        (r) => Math.sign(r) === spaceSign && Math.abs(r) >= Math.abs(avgExtraSpace) * 0.4
      ).length;
      if (
        Math.abs(avgExtraSpace) >= Math.max(1.2, lineFontSize * 0.12) &&
        consistentSpaceCount >= Math.ceil(spaceResiduals.length * 0.75)
      ) {
        wordSpacing = Math.max(-lineFontSize * 0.3, Math.min(lineFontSize * 2.0, avgExtraSpace));
      }
    }
  }

  const firstWord = words[0];
  const lastWord = words[words.length - 1];
  const actualLineWidth = Math.max(0, lastWord.right - firstWord.left);
  const fullText = words.map((w) => w.text).join(' ');
  const predictedWidth = calculateTrackedTextWidth(
    fullText,
    lineFontSize,
    lineFontFamily,
    resolvedTrackingPts,
    wordSpacing
  );

  let scaleX = 1;
  if (predictedWidth > 0 && actualLineWidth > 0) {
    const ratio = actualLineWidth / predictedWidth;
    if (Math.abs(ratio - 1) > 0.035) {
      scaleX = Math.max(0.75, Math.min(1.35, Math.round(ratio * 1000) / 1000));
    }
  }

  return {
    ...(letterSpacing ? { letterSpacing } : {}),
    letterSpacingPts: resolvedTrackingPts,
    ...(wordSpacing !== undefined ? { wordSpacing } : {}),
    scaleX,
  };
}

/**
 * Computes the canonical intra-paragraph baseline leading from an ordered cluster of text lines.
 *
 * Uses the lower median of positive baseline-to-baseline steps so that an extra inter-paragraph
 * gap inside a grouped cluster does not inflate the base line height of individual lines.
 *
 * @param cluster Ordered array of text lines in the cluster.
 * @param fallbackHeight Fallback line height in points when fewer than two lines exist.
 * @return Canonical base line height in points.
 */
export function computeClusterBaseLineHeight(
  cluster: readonly { baselineY?: number; fontSize?: number }[],
  fallbackHeight: number
): number {
  if (cluster.length <= 1) return fallbackHeight;
  const steps: number[] = [];
  for (let i = 1; i < cluster.length; i++) {
    const prevBase = cluster[i - 1].baselineY;
    const currBase = cluster[i].baselineY;
    if (prevBase !== undefined && currBase !== undefined) {
      const diff = Math.abs(prevBase - currBase);
      if (diff > 0.5) {
        steps.push(diff);
      }
    }
  }
  if (steps.length === 0) return fallbackHeight;
  if (steps.length === 1) return Math.round(steps[0] * 100) / 100;
  steps.sort((a, b) => a - b);
  const medianStep = steps[Math.floor((steps.length - 1) / 2)];
  return Math.round(medianStep * 100) / 100;
}

/**
 * Computes the extra vertical spacing (in points) between two consecutive lines beyond their
 * normal CSS block-flow line-height step (`0.5 * prevLineHeight + 0.5 * currLineHeight`).
 *
 * Returns zero when the actual baseline or top step matches normal line leading within 0.25pt.
 *
 * @param prevLine Preceding line geometry and typographic metrics.
 * @param currLine Current line geometry and typographic metrics.
 * @param defaultLineHeight Fallback line height in points.
 * @return Extra vertical spacing in points to apply as `marginTop` on the current line.
 */
export function computeInterLineExtraGapPts(
  prevLine: { baselineY?: number; top?: number; lineHeight?: number; fontSize?: number },
  currLine: { baselineY?: number; top?: number; lineHeight?: number; fontSize?: number },
  defaultLineHeight?: number
): number {
  const prevFs = prevLine.fontSize && prevLine.fontSize > 0 ? prevLine.fontSize : 12;
  const currFs = currLine.fontSize && currLine.fontSize > 0 ? currLine.fontSize : prevFs;
  const prevLh = prevLine.lineHeight && prevLine.lineHeight > 0
    ? prevLine.lineHeight
    : (defaultLineHeight && defaultLineHeight > 0 ? defaultLineHeight : prevFs * 1.25);
  const currLh = currLine.lineHeight && currLine.lineHeight > 0
    ? currLine.lineHeight
    : (defaultLineHeight && defaultLineHeight > 0 ? defaultLineHeight : currFs * 1.25);

  let actualStepPts = 0;
  if (
    prevLine.baselineY !== undefined &&
    currLine.baselineY !== undefined &&
    prevLine.baselineY > currLine.baselineY
  ) {
    actualStepPts = prevLine.baselineY - currLine.baselineY;
  } else if (
    prevLine.top !== undefined &&
    currLine.top !== undefined &&
    currLine.top > prevLine.top
  ) {
    actualStepPts = currLine.top - prevLine.top;
  } else {
    return 0;
  }

  const expectedStepPts = 0.5 * prevLh + 0.5 * currLh;
  const extraGapPts = actualStepPts - expectedStepPts;
  if (Math.abs(extraGapPts) <= 0.02) {
    return 0;
  }
  return Math.round(extraGapPts * 100) / 100;
}

/**
 * Propagates paragraph-level baseline leading uniformly to each `TextLine` in a cluster
 * so that `line.lineHeight` matches the paragraph's resolved leading across all lines.
 *
 * @param cluster Ordered array of text lines in the paragraph cluster.
 * @param paragraphLineHeight Paragraph-wide base line height in points.
 * @return Updated array of text lines with calibrated `lineHeight` values.
 */
export function calibrateClusterLineHeights(
  cluster: readonly TextLine[],
  paragraphLineHeight: number
): TextLine[] {
  if (cluster.length === 0) return [];
  const canonicalLh = computeClusterBaseLineHeight(cluster, paragraphLineHeight);
  for (let i = 0; i < cluster.length; i++) {
    const curr = cluster[i];
    const resolvedLh = canonicalLh > 0 ? canonicalLh : curr.fontSize * 1.25;
    curr.lineHeight = Math.round(resolvedLh * 100) / 100;
  }

  return cluster as TextLine[];
}

/**
 * Computes the vertical CSS top offset adjustment (in points) required to align a DOM text line box
 * (rendered with CSS `line-height: lineHeight`) with the PDF glyph top / baseline.
 *
 * In CSS inline formatting, half-leading `(lineHeight - fontSize) / 2` is added above the font em-box.
 * Subtracting the positive half-leading offset aligns the first line's glyphs with the PDF canvas layer.
 *
 * @param fontSize Dominant font size of the first line in points.
 * @param lineHeight Effective line height of the first line in points.
 * @return Vertical top offset adjustment in points (less than or equal to 0 for positive leading).
 */
export function computeHalfLeadingTopOffsetPts(fontSize: number, lineHeight?: number): number {
  if (!lineHeight || !Number.isFinite(lineHeight) || lineHeight <= 0 || fontSize <= 0) {
    return 0;
  }
  const halfLeading = (lineHeight - fontSize) / 2;
  // Clamp adjustment so extreme leading values never shift the box outside reasonable bounds
  return Math.max(-fontSize * 0.75, Math.min(fontSize * 0.25, -halfLeading));
}


/**
 * Reported Tf sizes at or below this value are treated as unit font sizes whose
 * visual point size is carried by the text matrix (`/F1 1 Tf 9 0 0 9 x y Tm`).
 */
export const UNIT_FONT_SIZE_THRESHOLD = 1.5;

/**
 * Resolves the visual point size of a glyph drawn with a unit Tf size.
 *
 * Multiplies the reported Tf size by the vertical scale of the glyph text
 * matrix so lowercase words without ascenders (`nom`, `au`) resolve to the same
 * size as accented or capitalised neighbours, unlike glyph box heuristics.
 *
 * @param reportedSize Tf font size reported by PDFium for the glyph.
 * @param matrixScaleY Vertical scale `hypot(c, d)` of the glyph text matrix.
 * @return Matrix-scaled size rounded to 0.01 pt, or null when the reported size
 *     is conventional or the matrix scale is unavailable or invalid.
 */
export function resolveMatrixScaledFontSize(
  reportedSize: number,
  matrixScaleY: number | null
): number | null {
  if (!Number.isFinite(reportedSize) || reportedSize <= 0 || reportedSize > UNIT_FONT_SIZE_THRESHOLD) {
    return null;
  }
  if (matrixScaleY === null || !Number.isFinite(matrixScaleY) || matrixScaleY <= 0) {
    return null;
  }
  const scaled = reportedSize * matrixScaleY;
  if (scaled <= UNIT_FONT_SIZE_THRESHOLD) return null;
  return Math.round(scaled * 100) / 100;
}
