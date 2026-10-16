/**
 * Pure TypeScript LaTeX mathematical formula transliterator and vector layout engine.
 * Converts LaTeX commands, fractions, roots, Greek symbols, and subscripts/superscripts
 * into WinAnsi-safe mathematical representations and renders structured formula blocks.
 */

import { PDFPage, PDFFont, rgb } from 'pdf-lib';
import type { MathBlock } from './types';
import { sanitizeTextForWinAnsi, safeWidthOfText } from './winansi-sanitizer';

/**
 * Mapping of common LaTeX commands to readable WinAnsi-compatible mathematical notation.
 */
const LATEX_SYMBOL_MAP: Readonly<Record<string, string>> = {
  '\\alpha': 'alpha',
  '\\beta': 'beta',
  '\\gamma': 'gamma',
  '\\delta': 'delta',
  '\\epsilon': 'epsilon',
  '\\varepsilon': 'epsilon',
  '\\zeta': 'zeta',
  '\\eta': 'eta',
  '\\theta': 'theta',
  '\\vartheta': 'theta',
  '\\iota': 'iota',
  '\\kappa': 'kappa',
  '\\lambda': 'lambda',
  '\\mu': '\u00b5',
  '\\nu': 'nu',
  '\\xi': 'xi',
  '\\pi': 'pi',
  '\\rho': 'rho',
  '\\sigma': 'sigma',
  '\\tau': 'tau',
  '\\upsilon': 'upsilon',
  '\\phi': 'phi',
  '\\varphi': 'phi',
  '\\chi': 'chi',
  '\\psi': 'psi',
  '\\omega': 'omega',
  '\\Gamma': 'Gamma',
  '\\Delta': 'Delta',
  '\\Theta': 'Theta',
  '\\Lambda': 'Lambda',
  '\\Xi': 'Xi',
  '\\Pi': 'Pi',
  '\\Sigma': 'Sigma',
  '\\Phi': 'Phi',
  '\\Psi': 'Psi',
  '\\Omega': 'Omega',
  '\\infty': 'infinity',
  '\\int': 'integral',
  '\\iint': 'double-integral',
  '\\iiint': 'triple-integral',
  '\\oint': 'contour-integral',
  '\\sum': 'sum',
  '\\prod': 'prod',
  '\\partial': 'd',
  '\\nabla': 'grad',
  '\\pm': '\u00b1',
  '\\mp': '-/+',
  '\\times': '\u00d7',
  '\\div': '\u00f7',
  '\\cdot': '\u00b7',
  '\\leq': '<=',
  '\\le': '<=',
  '\\geq': '>=',
  '\\ge': '>=',
  '\\neq': '!=',
  '\\ne': '!=',
  '\\approx': '~=',
  '\\equiv': '===',
  '\\sim': '~',
  '\\rightarrow': '->',
  '\\to': '->',
  '\\leftarrow': '<-',
  '\\Rightarrow': '=>',
  '\\Leftarrow': '<=',
  '\\leftrightarrow': '<->',
  '\\Leftrightarrow': '<=>',
  '\\forall': 'for all ',
  '\\exists': 'exists ',
  '\\in': ' in ',
  '\\notin': ' not in ',
  '\\subset': ' subset ',
  '\\subseteq': ' subseteq ',
  '\\cup': ' U ',
  '\\cap': ' intersect ',
  '\\emptyset': '{}',
  '\\dots': '...',
  '\\ldots': '...',
  '\\cdots': '...',
  '\\quad': '  ',
  '\\qquad': '    ',
  '\\,': ' ',
  '\\;': ' ',
  '\\!': '',
  '\\left': '',
  '\\right': '',
};

/**
 * Transliterates a raw LaTeX mathematical expression into a clean, human-readable
 * WinAnsi-compatible mathematical string.
 *
 * @param latex Raw LaTeX expression string.
 * @return Formatted mathematical string safe for standard PDF fonts.
 */
export function formatLatexFormula(latex: string): string {
  if (!latex) return '';

  let expr = latex.trim();

  // Strip surrounding $$ or $ delimiters if present
  expr = expr.replace(/^\$\$|\$\$$/g, '').replace(/^\$|\$$/g, '').trim();

  // Strip environment wrappers such as \begin{equation} ... \end{equation}
  expr = expr.replace(/\\begin\{[^}]+\}/g, '').replace(/\\end\{[^}]+\}/g, '');

  // Handle \text{...}, \mathrm{...}, \mathbf{...}, \mathit{...}
  expr = expr.replace(/\\(?:text|mathrm|mathbf|mathit|mathsf|mathcal)\{([^{}]*)\}/g, '$1');

  // Iteratively expand fractions: \frac{a}{b} -> (a)/(b)
  let prev = '';
  let guard = 0;
  while (expr !== prev && guard < 6) {
    prev = expr;
    guard++;
    expr = expr.replace(/\\(?:d|t)?frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)');
    expr = expr.replace(/\\sqrt\[([^\]]*)\]\{([^{}]*)\}/g, 'root($1, $2)');
    expr = expr.replace(/\\sqrt\{([^{}]*)\}/g, 'sqrt($1)');
  }

  // Format superscripts and subscripts with braces: _{...} and ^{...}
  expr = expr.replace(/\^\{([^{}]+)\}/g, '^($1)');
  expr = expr.replace(/_\{([^{}]+)\}/g, '_($1)');

  // Replace known LaTeX command tokens (longest match first)
  const sortedCommands = Object.keys(LATEX_SYMBOL_MAP).sort((a, b) => b.length - a.length);
  for (const cmd of sortedCommands) {
    const replacement = LATEX_SYMBOL_MAP[cmd];
    expr = expr.split(cmd).join(replacement);
  }

  // Strip remaining unknown backslash commands while preserving their name
  expr = expr.replace(/\\([a-zA-Z]+)/g, '$1');

  // Clean remaining curly braces and normalise horizontal whitespace
  expr = expr.replace(/[{}]/g, '');
  expr = expr.replace(/[ \t]+/g, ' ');

  return sanitizeTextForWinAnsi(expr).trim();
}

export interface MathRenderResult {
  readonly cardHeight: number;
  readonly lines: readonly string[];
}

/**
 * Prepares and measures a display math block for vector rendering in PDF.
 *
 * @param block Mathematical block definition.
 * @param printableWidth Available width on the document page.
 * @param font PDFFont used for formula measurement.
 * @param fontSize Font size in points.
 * @return Measured render result with formatted lines and card height.
 */
export function layoutMathBlock(
  block: MathBlock,
  printableWidth: number,
  font: PDFFont,
  fontSize: number = 11
): MathRenderResult {
  const formatted = formatLatexFormula(block.expression);
  const rawLines = formatted
    .split(/\n|\\\\/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const maxLineChars = Math.max(30, Math.floor((printableWidth - 28) / (fontSize * 0.55)));

  const wrappedLines: string[] = [];
  for (const raw of rawLines) {
    if (raw.length <= maxLineChars || safeWidthOfText(font, raw, fontSize) <= printableWidth - 28) {
      wrappedLines.push(raw);
    } else {
      const parts = raw.split(/(\s*=\s*|\s*\+\s*|\s*-\s*)/);
      let current = '';
      for (const part of parts) {
        if (current.length + part.length <= maxLineChars || current.length === 0) {
          current += part;
        } else {
          wrappedLines.push(current.trim());
          current = '  ' + part.trim();
        }
      }
      if (current.trim().length > 0) {
        wrappedLines.push(current.trim());
      }
    }
  }

  const paddingY = 10;
  const headerHeight = 16;
  const lineHeight = fontSize * 1.45;
  const finalLines = wrappedLines.length > 0 ? wrappedLines : [formatted || ''];
  const totalFormulaHeight = finalLines.length * lineHeight;
  const cardHeight = headerHeight + totalFormulaHeight + paddingY * 2;

  return {
    cardHeight,
    lines: finalLines,
  };
}

/**
 * Renders a display math block onto a PDF page with a subtle vector container and centred typography.
 *
 * @param page Target PDFPage instance.
 * @param pageHeight Total height of the page in points.
 * @param startX Left margin coordinate in points.
 * @param cursorY Top-down vertical cursor coordinate in points.
 * @param printableWidth Printable width available for the card.
 * @param block MathBlock to render.
 * @param fonts Embedded font references for rendering.
 * @return Total vertical height consumed by the rendered math block.
 */
export function renderMathBlock(
  page: PDFPage,
  pageHeight: number,
  startX: number,
  cursorY: number,
  printableWidth: number,
  block: MathBlock,
  fonts: { regular: PDFFont; italic: PDFFont; mono: PDFFont }
): number {
  const fontSize = 11;
  const layout = layoutMathBlock(block, printableWidth, fonts.italic, fontSize);
  const cardHeight = layout.cardHeight;
  const pdfCardY = pageHeight - cursorY - cardHeight;

  // Draw formula card background and border first (painter's algorithm)
  page.drawRectangle({
    x: startX,
    y: pdfCardY,
    width: printableWidth,
    height: cardHeight,
    color: rgb(0.976, 0.984, 0.992),
    borderColor: rgb(0.816, 0.843, 0.871),
    borderWidth: 0.75,
  });

  // Draw left mathematical accent bar
  page.drawRectangle({
    x: startX,
    y: pdfCardY,
    width: 3.5,
    height: cardHeight,
    color: rgb(0.31, 0.38, 0.55),
  });

  // Draw subtle top label
  page.drawText('Formula', {
    x: startX + 10,
    y: pageHeight - cursorY - 13,
    size: 7.5,
    font: fonts.mono,
    color: rgb(0.42, 0.47, 0.54),
  });

  // Draw centred mathematical expression lines
  const lineHeight = fontSize * 1.45;
  let lineY = cursorY + 22;
  for (const line of layout.lines) {
    const cleanLine = sanitizeTextForWinAnsi(line);
    if (cleanLine.length > 0) {
      const textWidth = safeWidthOfText(fonts.italic, cleanLine, fontSize);
      const textX = Math.max(startX + 14, startX + (printableWidth - textWidth) / 2);
      page.drawText(cleanLine, {
        x: textX,
        y: pageHeight - lineY - fontSize * 0.8,
        size: fontSize,
        font: fonts.italic,
        color: rgb(0.12, 0.14, 0.18),
      });
    }
    lineY += lineHeight;
  }

  return cardHeight;
}
