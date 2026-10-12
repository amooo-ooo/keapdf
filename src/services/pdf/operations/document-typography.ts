/**
 * Semantic document typography profiling and statistical style analysis.
 *
 * Analyses document text spans to identify dominant body, caption, title,
 * subtitle, and heading typography, extracting canonical font families,
 * font sizes, weights, legible colours, and alignments to ensure newly
 * created text components match the native document aesthetic.
 */

import type { EditableTextSpan, ColorRgba } from '../../../core/types';
import type { ElementDropPayload } from '../../../stores/canvas-types';
import {
  isTableValueOrDataCell,
  isSpanInTableRow,
} from './outline-tree';
import {
  mapStandardFontName,
  cleanSubsetPrefix,
  isBoldFontName,
  isItalicFontName,
} from '../../../core/pdfium-helpers';
import { extractBaseFontFamily } from '../font-charset-index';
import { resolveCommercialFontAlias } from '../../font-aliases';

/**
 * Typographic styling properties for a specific content role or heading level.
 */
export interface TypographyStyleProfile {
  fontSize: number;
  fontFamily: string;
  rawFontFamily?: string;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  color: string;
  textAlign: 'left' | 'center' | 'right';
  lineHeight?: number;
}

/**
 * Identifier for a semantic text style preset.
 */
export type TextStylePresetId =
  | 'title'
  | 'subtitle'
  | 'heading'
  | 'subheading'
  | 'body'
  | 'caption';

/**
 * Metadata and layout multipliers for a semantic text style preset.
 */
export interface TextStylePresetMeta {
  id: TextStylePresetId;
  label: string;
  defaultText: string;
  featureFlag:
    | 'components.title'
    | 'components.subtitle'
    | 'components.heading'
    | 'components.subheading'
    | 'components.body-text'
    | 'components.caption';
  widthMultiplier: number;
  minWidth: number;
  heightMultiplier: number;
}

/**
 * Complete document typography profile with dominant body, caption, title,
 * subtitle, and hierarchical heading tiers.
 */
export interface DocumentTypographyProfile {
  title: TypographyStyleProfile;
  subtitle: TypographyStyleProfile;
  body: TypographyStyleProfile;
  caption: TypographyStyleProfile;
  headings: Record<number, TypographyStyleProfile>;
  h1: TypographyStyleProfile;
  h2: TypographyStyleProfile;
  h3: TypographyStyleProfile;
}

/**
 * Ordered definitions of all built-in semantic text style presets.
 */
export const TEXT_STYLE_PRESETS: readonly TextStylePresetMeta[] = [
  {
    id: 'title',
    label: 'Title',
    defaultText: 'Title',
    featureFlag: 'components.title',
    widthMultiplier: 9.5,
    minWidth: 220,
    heightMultiplier: 1.5,
  },
  {
    id: 'subtitle',
    label: 'Subtitle',
    defaultText: 'Subtitle',
    featureFlag: 'components.subtitle',
    widthMultiplier: 11,
    minWidth: 200,
    heightMultiplier: 1.6,
  },
  {
    id: 'heading',
    label: 'Heading',
    defaultText: 'Heading',
    featureFlag: 'components.heading',
    widthMultiplier: 9,
    minWidth: 200,
    heightMultiplier: 1.6,
  },
  {
    id: 'subheading',
    label: 'Subheading',
    defaultText: 'Subheading',
    featureFlag: 'components.subheading',
    widthMultiplier: 10,
    minWidth: 190,
    heightMultiplier: 1.6,
  },
  {
    id: 'body',
    label: 'Body Text',
    defaultText: 'Body text paragraph',
    featureFlag: 'components.body-text',
    widthMultiplier: 15,
    minWidth: 180,
    heightMultiplier: 2.4,
  },
  {
    id: 'caption',
    label: 'Caption',
    defaultText: 'Caption text',
    featureFlag: 'components.caption',
    widthMultiplier: 14,
    minWidth: 160,
    heightMultiplier: 1.8,
  },
];

/**
 * Rounds a point size to the nearest 0.5pt increment.
 *
 * @param value Point size to round.
 * @return Rounded point size.
 */
function roundToHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

/**
 * Converts a ColorRgba object to a standard hex colour string.
 *
 * @param color RGBA colour structure.
 * @return Lowercase hex colour string.
 */
function rgbaToHex(color?: ColorRgba): string {
  if (!color) return '#000000';
  const r = Math.max(0, Math.min(255, Math.round(color.r))).toString(16).padStart(2, '0');
  const g = Math.max(0, Math.min(255, Math.round(color.g))).toString(16).padStart(2, '0');
  const b = Math.max(0, Math.min(255, Math.round(color.b))).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

/**
 * Parses a hex colour string into RGB components in the 0 to 255 range.
 *
 * @param hex Hex colour string.
 * @return Parsed RGB tuple or null when invalid.
 */
function parseHexRgb(hex: string): { r: number; g: number; b: number } | null {
  const cleaned = hex.trim().replace(/^#/, '');
  if (cleaned.length === 3) {
    const r = parseInt(cleaned[0] + cleaned[0], 16);
    const g = parseInt(cleaned[1] + cleaned[1], 16);
    const b = parseInt(cleaned[2] + cleaned[2], 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return { r, g, b };
  }
  if (cleaned.length >= 6) {
    const r = parseInt(cleaned.slice(0, 2), 16);
    const g = parseInt(cleaned.slice(2, 4), 16);
    const b = parseInt(cleaned.slice(4, 6), 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return { r, g, b };
  }
  return null;
}

/**
 * Evaluates whether a text colour is legible when placed on a standard light PDF page.
 * Filters out white and high-luminance pastel colours extracted from dark hero banners.
 *
 * @param color Hex colour string or ColorRgba object.
 * @return True if the colour has sufficient contrast on a white background.
 */
export function isLegibleTextColorOnLightPage(color?: string | ColorRgba): boolean {
  if (!color) return true;
  const rgb = typeof color === 'string' ? parseHexRgb(color) : color;
  if (!rgb) return true;
  const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return luminance <= 0.72;
}

/**
 * Canonicalises a PDF font family name by stripping subset prefixes and style suffixes.
 *
 * @param fontFamily Primary font family name.
 * @param rawFontFamily Optional raw font family from the PDF stream.
 * @param fallback Fallback family when neither input resolves.
 * @return Canonical base font family name.
 */
export function canonicalizeTypographyFontFamily(
  fontFamily?: string,
  rawFontFamily?: string,
  fallback: string = 'Helvetica'
): string {
  const candidate = (fontFamily || rawFontFamily || '').trim();
  if (!candidate) return fallback;

  const cleaned = cleanSubsetPrefix(candidate).trim();
  const base = extractBaseFontFamily(cleaned).trim() || cleaned;
  const lower = base.toLowerCase();

  if (
    lower === 'helvetica' ||
    lower.startsWith('helvetica-') ||
    lower === 'helv'
  ) {
    return 'Helvetica';
  }
  if (lower === 'inter' || lower.startsWith('inter-')) {
    return 'Inter';
  }
  if (
    lower === 'times' ||
    lower === 'times-roman' ||
    lower.startsWith('times-') ||
    lower === 'times new roman' ||
    lower.startsWith('timesnewroman')
  ) {
    return 'Times-Roman';
  }
  if (
    lower === 'courier' ||
    lower.startsWith('courier-') ||
    lower === 'courier new' ||
    lower.startsWith('couriernew')
  ) {
    return 'Courier';
  }
  if (lower === 'arial' || lower === 'arialmt' || lower.startsWith('arial-') || lower.startsWith('arialmt')) {
    return 'Arial';
  }
  if (lower === 'georgia' || lower.startsWith('georgia-')) {
    return 'Georgia';
  }
  if (lower === 'roboto' || lower.startsWith('roboto-')) {
    return 'Roboto';
  }

  const alias = resolveCommercialFontAlias(cleaned) || resolveCommercialFontAlias(base);
  if (alias) {
    return alias.canonicalName;
  }

  if (rawFontFamily && base === candidate) {
    const mapped = mapStandardFontName(rawFontFamily);
    if (mapped && mapped !== candidate) {
      return canonicalizeTypographyFontFamily(mapped, undefined, fallback);
    }
  }

  return base || fallback;
}

/**
 * Determines whether a text span uses bold weight from its weight property or font name.
 *
 * @param span Editable text span to inspect.
 * @return True if the span is bold.
 */
function isSpanBold(span: EditableTextSpan): boolean {
  if (span.fontWeight === 'bold') return true;
  const fontRef = span.rawFontFamily || span.fontFamily || '';
  if (isBoldFontName(fontRef, span.fontWeight)) return true;
  const lower = fontRef.toLowerCase();
  return (
    lower.includes('bold') ||
    lower.includes('black') ||
    lower.includes('heavy') ||
    lower.includes('semibold') ||
    lower.includes('demi')
  );
}

/**
 * Determines whether a text span uses italic or oblique posture.
 *
 * @param span Editable text span to inspect.
 * @return True if the span is italic or oblique.
 */
function isSpanItalic(span: EditableTextSpan): boolean {
  if (span.fontStyle === 'italic') return true;
  const fontRef = span.rawFontFamily || span.fontFamily || '';
  return isItalicFontName(fontRef, span.fontStyle);
}

/**
 * Computes the statistical mode (highest weighted frequency) from a map of counts.
 *
 * @param frequencyMap Weighted frequency table.
 * @param fallback Default key when the map is empty.
 * @return Dominant key with highest weight.
 */
function getDominantKey<T extends string | number>(frequencyMap: Map<T, number>, fallback: T): T {
  let highestCount = -1;
  let dominantKey = fallback;
  for (const [key, count] of frequencyMap.entries()) {
    if (count > highestCount) {
      highestCount = count;
      dominantKey = key;
    }
  }
  return dominantKey;
}

/**
 * Builds a typography style profile from a collection of candidate text spans.
 *
 * @param spans Candidate spans for the tier.
 * @param defaultFontSize Fallback font size in points.
 * @param defaultFontWeight Fallback font weight.
 * @param fallbackFamily Fallback canonical font family.
 * @param fallbackColor Fallback hex colour string.
 * @return Resolved typography style profile.
 */
function buildStyleProfileFromSpans(
  spans: EditableTextSpan[],
  defaultFontSize: number,
  defaultFontWeight: 'normal' | 'bold',
  fallbackFamily: string = 'Helvetica',
  fallbackColor: string = '#000000'
): TypographyStyleProfile {
  const safeFallbackColor = isLegibleTextColorOnLightPage(fallbackColor) ? fallbackColor : '#000000';
  if (spans.length === 0) {
    return {
      fontSize: defaultFontSize,
      fontFamily: canonicalizeTypographyFontFamily(fallbackFamily, undefined, 'Helvetica'),
      fontWeight: defaultFontWeight,
      fontStyle: 'normal',
      color: safeFallbackColor,
      textAlign: 'left',
    };
  }

  const fontSizeWeights = new Map<number, number>();
  const fontFamilyWeights = new Map<string, number>();
  const rawFamilyWeights = new Map<string, number>();
  const colorWeights = new Map<string, number>();
  const alignWeights = new Map<'left' | 'center' | 'right', number>();
  const weightVotes = new Map<'normal' | 'bold', number>();
  const styleVotes = new Map<'normal' | 'italic', number>();
  let totalLineHeight = 0;
  let lineHeightCount = 0;

  for (const span of spans) {
    const charCount = Math.max(1, span.charCount || span.text.length);
    const roundedSize = span.fontSize ? roundToHalf(span.fontSize) : defaultFontSize;

    fontSizeWeights.set(roundedSize, (fontSizeWeights.get(roundedSize) || 0) + charCount);

    const family = canonicalizeTypographyFontFamily(span.fontFamily, span.rawFontFamily, fallbackFamily);
    fontFamilyWeights.set(family, (fontFamilyWeights.get(family) || 0) + charCount);

    const rawCandidate = span.rawFontFamily || span.fontFamily;
    if (rawCandidate) {
      const cleanRaw = cleanSubsetPrefix(rawCandidate);
      rawFamilyWeights.set(cleanRaw, (rawFamilyWeights.get(cleanRaw) || 0) + charCount);
    }

    const hexColor = rgbaToHex(span.color);
    if (isLegibleTextColorOnLightPage(hexColor)) {
      colorWeights.set(hexColor, (colorWeights.get(hexColor) || 0) + charCount);
    }

    const align: 'left' | 'center' | 'right' =
      span.textAlign === 'center' || span.textAlign === 'right' ? span.textAlign : 'left';
    alignWeights.set(align, (alignWeights.get(align) || 0) + charCount);

    const voteWeight: 'normal' | 'bold' = isSpanBold(span) ? 'bold' : 'normal';
    weightVotes.set(voteWeight, (weightVotes.get(voteWeight) || 0) + charCount);

    const voteStyle: 'normal' | 'italic' = isSpanItalic(span) ? 'italic' : 'normal';
    styleVotes.set(voteStyle, (styleVotes.get(voteStyle) || 0) + charCount);

    if (span.lineHeight && span.lineHeight > 0) {
      totalLineHeight += span.lineHeight;
      lineHeightCount++;
    }
  }

  const dominantFontSize = getDominantKey(fontSizeWeights, defaultFontSize);
  const dominantFontFamily = getDominantKey(fontFamilyWeights, fallbackFamily);
  const dominantRawFamily = rawFamilyWeights.size > 0 ? getDominantKey(rawFamilyWeights, '') : undefined;
  const dominantColor = getDominantKey(colorWeights, safeFallbackColor);
  const dominantAlign = getDominantKey(alignWeights, 'left');
  const dominantWeight = getDominantKey(weightVotes, defaultFontWeight);
  const dominantStyle = getDominantKey(styleVotes, 'normal');

  const avgLineHeight =
    lineHeightCount > 0 ? Math.round((totalLineHeight / lineHeightCount) * 10) / 10 : undefined;

  return {
    fontSize: dominantFontSize,
    fontFamily: dominantFontFamily,
    rawFontFamily: dominantRawFamily || undefined,
    fontWeight: dominantWeight,
    fontStyle: dominantStyle,
    color: dominantColor,
    textAlign: dominantAlign,
    lineHeight: avgLineHeight,
  };
}

/**
 * Clones a base typography profile with an overridden font size and weight.
 *
 * @param base Base typography profile to inherit family, colour, and alignment from.
 * @param fontSize Target font size in points.
 * @param fontWeight Target font weight.
 * @return Derived typography style profile.
 */
function deriveTierProfile(
  base: TypographyStyleProfile,
  fontSize: number,
  fontWeight: 'normal' | 'bold' = 'bold'
): TypographyStyleProfile {
  return {
    fontSize: roundToHalf(fontSize),
    fontFamily: base.fontFamily,
    rawFontFamily: base.rawFontFamily,
    fontWeight,
    fontStyle: 'normal',
    color: base.color,
    textAlign: base.textAlign,
  };
}

/**
 * Clusters candidate heading spans into descending font-size tiers.
 *
 * @param headingSpans Candidate heading spans.
 * @param bodyProfile Resolved dominant body profile.
 * @return Array of heading style profiles ordered from largest to smallest font size.
 */
function buildDescendingHeadingTiers(
  headingSpans: EditableTextSpan[],
  bodyProfile: TypographyStyleProfile
): TypographyStyleProfile[] {
  if (headingSpans.length === 0) return [];

  const sorted = [...headingSpans].sort((a, b) => (b.fontSize || 0) - (a.fontSize || 0));
  const clusters: { anchorSize: number; spans: EditableTextSpan[] }[] = [];

  for (const span of sorted) {
    const size = roundToHalf(span.fontSize || bodyProfile.fontSize);
    if (size <= bodyProfile.fontSize + 0.25) continue;

    const existing = clusters.find((c) => Math.abs(c.anchorSize - size) <= 1.0);
    if (existing) {
      existing.spans.push(span);
    } else {
      clusters.push({ anchorSize: size, spans: [span] });
    }
  }

  const profiles: TypographyStyleProfile[] = [];
  const seenSizes = new Set<number>();

  for (const cluster of clusters) {
    const profile = buildStyleProfileFromSpans(
      cluster.spans,
      cluster.anchorSize,
      'bold',
      bodyProfile.fontFamily,
      bodyProfile.color
    );
    profile.fontWeight = 'bold';
    if (profile.fontSize > bodyProfile.fontSize && !seenSizes.has(profile.fontSize)) {
      seenSizes.add(profile.fontSize);
      profiles.push(profile);
    }
  }

  return profiles.sort((a, b) => b.fontSize - a.fontSize);
}

/**
 * Semantically analyses document text spans to determine dominant body text,
 * caption, title, subtitle, and heading typography profiles across all tiers.
 *
 * @param spans Collection of all editable text spans across document pages.
 * @return Inferred document typography profile with strict monotonic size hierarchy.
 */
export function analyzeDocumentTypography(spans: EditableTextSpan[]): DocumentTypographyProfile {
  const defaultBody: TypographyStyleProfile = {
    fontSize: 12,
    fontFamily: 'Helvetica',
    fontWeight: 'normal',
    fontStyle: 'normal',
    color: '#000000',
    textAlign: 'left',
  };

  const defaultTitle: TypographyStyleProfile = {
    fontSize: 28,
    fontFamily: 'Helvetica',
    fontWeight: 'bold',
    fontStyle: 'normal',
    color: '#000000',
    textAlign: 'left',
  };

  const defaultSubtitle: TypographyStyleProfile = {
    fontSize: 15,
    fontFamily: 'Helvetica',
    fontWeight: 'normal',
    fontStyle: 'normal',
    color: '#000000',
    textAlign: 'left',
  };

  const defaultH1: TypographyStyleProfile = {
    fontSize: 22,
    fontFamily: 'Helvetica',
    fontWeight: 'bold',
    fontStyle: 'normal',
    color: '#000000',
    textAlign: 'left',
  };

  const defaultH2: TypographyStyleProfile = {
    fontSize: 18,
    fontFamily: 'Helvetica',
    fontWeight: 'bold',
    fontStyle: 'normal',
    color: '#000000',
    textAlign: 'left',
  };

  const defaultH3: TypographyStyleProfile = {
    fontSize: 14,
    fontFamily: 'Helvetica',
    fontWeight: 'bold',
    fontStyle: 'normal',
    color: '#000000',
    textAlign: 'left',
  };

  const defaultCaption: TypographyStyleProfile = {
    fontSize: 10,
    fontFamily: 'Helvetica',
    fontWeight: 'normal',
    fontStyle: 'normal',
    color: '#000000',
    textAlign: 'left',
  };

  if (!spans || spans.length === 0) {
    return {
      title: defaultTitle,
      subtitle: defaultSubtitle,
      body: defaultBody,
      caption: defaultCaption,
      headings: { 1: defaultH1, 2: defaultH2, 3: defaultH3 },
      h1: defaultH1,
      h2: defaultH2,
      h3: defaultH3,
    };
  }

  const spansByPage = new Map<number, EditableTextSpan[]>();
  for (const span of spans) {
    const pageList = spansByPage.get(span.pageIndex);
    if (pageList) {
      pageList.push(span);
    } else {
      spansByPage.set(span.pageIndex, [span]);
    }
  }

  const contentSpans: EditableTextSpan[] = [];
  for (const span of spans) {
    const text = (span.text || '').trim();
    if (text.length <= 1) continue;
    if (/^\d{1,4}$/.test(text)) continue;
    if (isTableValueOrDataCell(text)) continue;
    const pageSpans = spansByPage.get(span.pageIndex) ?? [span];
    if (isSpanInTableRow(span, pageSpans)) continue;
    contentSpans.push(span);
  }

  if (contentSpans.length === 0) {
    return {
      title: defaultTitle,
      subtitle: defaultSubtitle,
      body: defaultBody,
      caption: defaultCaption,
      headings: { 1: defaultH1, 2: defaultH2, 3: defaultH3 },
      h1: defaultH1,
      h2: defaultH2,
      h3: defaultH3,
    };
  }

  // Identify standard prose spans (9pt to 14pt, non-bold or multi-line paragraph, legible colour)
  const legibleProseSpans = contentSpans.filter(
    (s) =>
      s.fontSize >= 9 &&
      s.fontSize <= 14 &&
      (!isSpanBold(s) || Boolean(s.isParagraph)) &&
      isLegibleTextColorOnLightPage(s.color)
  );
  const fallbackProseSpans = contentSpans.filter(
    (s) => s.fontSize >= 9 && s.fontSize <= 14 && (!isSpanBold(s) || Boolean(s.isParagraph))
  );
  const mediumSpans = contentSpans.filter(
    (s) => s.fontSize <= 14 && isLegibleTextColorOnLightPage(s.color)
  );

  const bodyCandidateSpans =
    legibleProseSpans.length > 0
      ? legibleProseSpans
      : fallbackProseSpans.length > 0
        ? fallbackProseSpans
        : mediumSpans.length > 0
          ? mediumSpans
          : contentSpans;

  const bodyProfile = buildStyleProfileFromSpans(
    bodyCandidateSpans,
    12,
    'normal',
    'Helvetica',
    '#000000'
  );
  bodyProfile.fontWeight = 'normal';

  // Identify caption / fine-print spans strictly smaller than body text
  const captionCandidates = contentSpans.filter(
    (s) =>
      s.fontSize > 0 &&
      s.fontSize <= bodyProfile.fontSize - 1 &&
      s.fontSize <= 10.5 &&
      isLegibleTextColorOnLightPage(s.color)
  );
  const defaultCaptionSize = roundToHalf(
    Math.max(8, Math.min(bodyProfile.fontSize - 1.5, bodyProfile.fontSize * 0.85))
  );
  const captionProfile =
    captionCandidates.length > 0
      ? buildStyleProfileFromSpans(
          captionCandidates,
          defaultCaptionSize,
          'normal',
          bodyProfile.fontFamily,
          bodyProfile.color
        )
      : deriveTierProfile(bodyProfile, defaultCaptionSize, 'normal');
  captionProfile.fontWeight = 'normal';

  // Identify heading candidates strictly larger than body text
  const headingCandidates = contentSpans.filter((s) => {
    const text = s.text.trim();
    if (text.length > 180) return false;
    const bold = isSpanBold(s);
    if (s.fontSize >= bodyProfile.fontSize + 3) return true;
    if (s.isParagraph) return false;
    if (s.fontSize >= Math.max(13, bodyProfile.fontSize + 1.5)) return true;
    if (bold && s.fontSize >= bodyProfile.fontSize + 0.5) return true;
    return false;
  });

  const tiers = buildDescendingHeadingTiers(headingCandidates, bodyProfile);

  const fallbackH1Size = Math.max(20, roundToHalf(bodyProfile.fontSize * 1.8));
  const fallbackH2Size = Math.max(16, roundToHalf(bodyProfile.fontSize * 1.4));
  const fallbackH3Size = Math.max(13, roundToHalf(bodyProfile.fontSize * 1.15));

  let titleProfile: TypographyStyleProfile;
  let h1Profile: TypographyStyleProfile;
  let h2Profile: TypographyStyleProfile;
  let h3Profile: TypographyStyleProfile;

  if (tiers.length === 0) {
    h1Profile = deriveTierProfile(bodyProfile, fallbackH1Size, 'bold');
    h2Profile = deriveTierProfile(bodyProfile, fallbackH2Size, 'bold');
    h3Profile = deriveTierProfile(bodyProfile, fallbackH3Size, 'bold');
    titleProfile = deriveTierProfile(
      h1Profile,
      Math.max(26, roundToHalf(h1Profile.fontSize * 1.25)),
      'bold'
    );
  } else if (tiers.length === 1) {
    h1Profile = tiers[0];
    titleProfile = deriveTierProfile(
      h1Profile,
      Math.max(h1Profile.fontSize + 4, roundToHalf(h1Profile.fontSize * 1.25)),
      'bold'
    );
    const targetH2 = Math.min(h1Profile.fontSize - 2, fallbackH2Size);
    h2Profile = deriveTierProfile(
      bodyProfile,
      Math.max(bodyProfile.fontSize + 2, targetH2),
      'bold'
    );
    const targetH3 = Math.min(h2Profile.fontSize - 1.5, fallbackH3Size);
    h3Profile = deriveTierProfile(
      bodyProfile,
      Math.max(bodyProfile.fontSize + 1, targetH3),
      'bold'
    );
  } else if (tiers.length === 2) {
    if (tiers[0].fontSize >= 24 && tiers[1].fontSize >= 16) {
      titleProfile = tiers[0];
      h1Profile = tiers[1];
      const targetH2 = Math.min(h1Profile.fontSize - 2, fallbackH2Size);
      h2Profile = deriveTierProfile(
        bodyProfile,
        Math.max(bodyProfile.fontSize + 2, targetH2),
        'bold'
      );
      const targetH3 = Math.min(h2Profile.fontSize - 1.5, fallbackH3Size);
      h3Profile = deriveTierProfile(
        bodyProfile,
        Math.max(bodyProfile.fontSize + 1, targetH3),
        'bold'
      );
    } else {
      h1Profile = tiers[0];
      h2Profile = tiers[1];
      titleProfile = deriveTierProfile(
        h1Profile,
        Math.max(h1Profile.fontSize + 4, roundToHalf(h1Profile.fontSize * 1.25)),
        'bold'
      );
      const targetH3 = Math.min(h2Profile.fontSize - 1, fallbackH3Size);
      h3Profile = deriveTierProfile(
        bodyProfile,
        Math.max(bodyProfile.fontSize + 1, targetH3),
        'bold'
      );
    }
  } else if (tiers.length === 3) {
    if (tiers[0].fontSize >= 24 && tiers[1].fontSize >= 16) {
      titleProfile = tiers[0];
      h1Profile = tiers[1];
      h2Profile = tiers[2];
      const targetH3 = Math.min(h2Profile.fontSize - 1, fallbackH3Size);
      h3Profile = deriveTierProfile(
        bodyProfile,
        Math.max(bodyProfile.fontSize + 1, targetH3),
        'bold'
      );
    } else {
      h1Profile = tiers[0];
      h2Profile = tiers[1];
      h3Profile = tiers[2];
      titleProfile = deriveTierProfile(
        h1Profile,
        Math.max(h1Profile.fontSize + 4, roundToHalf(h1Profile.fontSize * 1.25)),
        'bold'
      );
    }
  } else {
    titleProfile = tiers[0];
    h1Profile = tiers[1];
    h2Profile = tiers[2];
    h3Profile = tiers[3];
  }

  // Enforce strict monotonic size ordering across all hierarchical tiers
  captionProfile.fontSize = roundToHalf(
    Math.min(captionProfile.fontSize, Math.max(6, bodyProfile.fontSize - 1))
  );
  h3Profile.fontSize = roundToHalf(Math.max(h3Profile.fontSize, bodyProfile.fontSize + 1));
  h2Profile.fontSize = roundToHalf(Math.max(h2Profile.fontSize, h3Profile.fontSize + 1.5));
  h1Profile.fontSize = roundToHalf(Math.max(h1Profile.fontSize, h2Profile.fontSize + 2));
  titleProfile.fontSize = roundToHalf(Math.max(titleProfile.fontSize, h1Profile.fontSize + 3));

  // Build subtitle profile (normal weight, sized between body and H1)
  const subtitleCandidates = contentSpans.filter(
    (s) =>
      !isSpanBold(s) &&
      s.fontSize >= bodyProfile.fontSize + 1 &&
      s.fontSize <= h1Profile.fontSize - 1 &&
      s.text.trim().length <= 180 &&
      isLegibleTextColorOnLightPage(s.color)
  );
  const defaultSubtitleSize = roundToHalf(
    Math.max(
      bodyProfile.fontSize + 1.5,
      Math.min(h1Profile.fontSize - 1.5, bodyProfile.fontSize * 1.25)
    )
  );
  const subtitleProfile =
    subtitleCandidates.length > 0
      ? buildStyleProfileFromSpans(
          subtitleCandidates,
          defaultSubtitleSize,
          'normal',
          bodyProfile.fontFamily,
          bodyProfile.color
        )
      : deriveTierProfile(bodyProfile, defaultSubtitleSize, 'normal');
  subtitleProfile.fontWeight = 'normal';
  subtitleProfile.fontSize = roundToHalf(
    Math.max(
      bodyProfile.fontSize + 1,
      Math.min(h1Profile.fontSize - 1, subtitleProfile.fontSize)
    )
  );

  const headings: Record<number, TypographyStyleProfile> = {
    1: h1Profile,
    2: h2Profile,
    3: h3Profile,
  };

  for (let i = 4; i < Math.min(7, tiers.length + 1); i++) {
    const extraTier = tiers[i];
    if (extraTier) {
      headings[i] = extraTier;
    }
  }

  return {
    title: titleProfile,
    subtitle: subtitleProfile,
    body: bodyProfile,
    caption: captionProfile,
    headings,
    h1: h1Profile,
    h2: h2Profile,
    h3: h3Profile,
  };
}

/**
 * Resolves the typography style profile for a given text preset identifier.
 *
 * @param presetId Semantic preset identifier.
 * @param typography Optional document typography profile (falls back to defaults).
 * @return Resolved typography style profile for the preset.
 */
export function getPresetStyleProfile(
  presetId: TextStylePresetId,
  typography?: DocumentTypographyProfile | null
): TypographyStyleProfile {
  const profile = typography ?? analyzeDocumentTypography([]);
  switch (presetId) {
    case 'title':
      return profile.title;
    case 'subtitle':
      return profile.subtitle;
    case 'heading':
      return profile.h1;
    case 'subheading':
      return profile.h2;
    case 'body':
      return profile.body;
    case 'caption':
      return profile.caption;
  }
}

/**
 * Builds a complete canvas element placement and drag payload for a text preset.
 *
 * @param presetId Semantic preset identifier.
 * @param typography Optional document typography profile.
 * @return ElementDropPayload with calculated dimensions and typographic properties.
 */
export function resolveTextPresetPayload(
  presetId: TextStylePresetId,
  typography?: DocumentTypographyProfile | null
): ElementDropPayload & {
  kind: 'text';
  text: string;
  label: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  fontFamily: string;
  rawFontFamily?: string;
  color: string;
  textAlign: 'left' | 'center' | 'right';
  lineHeight?: number;
  width: number;
  height: number;
} {
  const meta = TEXT_STYLE_PRESETS.find((p) => p.id === presetId) ?? TEXT_STYLE_PRESETS[4];
  const style = getPresetStyleProfile(presetId, typography);
  const width = Math.max(meta.minWidth, Math.round(style.fontSize * meta.widthMultiplier));
  const height = Math.ceil(style.fontSize * meta.heightMultiplier);

  return {
    kind: 'text',
    text: meta.defaultText,
    label: meta.label,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    fontFamily: style.fontFamily,
    rawFontFamily: style.rawFontFamily,
    color: style.color,
    textAlign: style.textAlign,
    lineHeight: style.lineHeight,
    width,
    height,
  };
}

/**
 * Detects which semantic text preset matches the given typographic attributes.
 *
 * @param current Active font size, weight, and style from the selection.
 * @param typography Optional document typography profile.
 * @return Matching preset identifier or 'custom' if no preset matches.
 */
export function detectMatchingTextPreset(
  current: {
    fontSize?: number;
    fontWeight?: 'normal' | 'bold';
    fontStyle?: 'normal' | 'italic';
  },
  typography?: DocumentTypographyProfile | null
): TextStylePresetId | 'custom' {
  if (!current.fontSize || Number.isNaN(current.fontSize)) {
    return 'custom';
  }

  const profile = typography ?? analyzeDocumentTypography([]);
  const currentWeight = current.fontWeight || 'normal';
  const orderedIds: TextStylePresetId[] = [
    'title',
    'heading',
    'subheading',
    'subtitle',
    'body',
    'caption',
  ];

  let bestExactMatch: { id: TextStylePresetId; diff: number } | null = null;
  for (const id of orderedIds) {
    const style = getPresetStyleProfile(id, profile);
    const diff = Math.abs(current.fontSize - style.fontSize);
    if (diff <= 0.75 && style.fontWeight === currentWeight) {
      if (!bestExactMatch || diff < bestExactMatch.diff) {
        bestExactMatch = { id, diff };
      }
    }
  }

  if (bestExactMatch) {
    return bestExactMatch.id;
  }

  return 'custom';
}

