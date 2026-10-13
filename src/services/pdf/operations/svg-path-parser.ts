import type { PdfiumEngine } from '../../../core/pdfium-engine';
import { setPageObjectMatrix, getPageCropInfo } from '../../../core/pdfium-helpers';
import { parseColor, buildTransformMatrix } from '../utils';
import type { SvgPathOptions } from './types';

/**
 * Normalised geometric command representation for vector paths.
 */
export type SvgCommand =
  | { type: 'M'; x: number; y: number }
  | { type: 'L'; x: number; y: number }
  | { type: 'C'; cp1x: number; cp1y: number; cp2x: number; cp2y: number; x: number; y: number }
  | { type: 'Z' };

/**
 * Tokenises SVG path command string into command letters and numeric arguments.
 */
function tokeniseSvgPath(d: string): Array<string | number> {
  const tokens: Array<string | number> = [];
  const regex = /([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?)/g;
  let match: RegExpExecArray | null = regex.exec(d);
  while (match !== null) {
    if (match[1]) {
      tokens.push(match[1]);
    } else if (match[2]) {
      tokens.push(parseFloat(match[2]));
    }
    match = regex.exec(d);
  }
  return tokens;
}

/**
 * Converts an elliptical arc segment into one or more cubic Bezier curve segments.
 */
function arcToBeziers(
  x0: number,
  y0: number,
  rxIn: number,
  ryIn: number,
  angleDeg: number,
  largeArcFlag: boolean,
  sweepFlag: boolean,
  x1: number,
  y1: number
): Array<{ cp1x: number; cp1y: number; cp2x: number; cp2y: number; x: number; y: number }> {
  if (x0 === x1 && y0 === y1) return [];

  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) {
    return [{ cp1x: x0, cp1y: y0, cp2x: x1, cp2y: y1, x: x1, y: y1 }];
  }

  const phi = (angleDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx2 = (x0 - x1) / 2;
  const dy2 = (y0 - y1) / 2;
  const x1Prime = cosPhi * dx2 + sinPhi * dy2;
  const y1Prime = -sinPhi * dx2 + cosPhi * dy2;

  const lambda = (x1Prime * x1Prime) / (rx * rx) + (y1Prime * y1Prime) / (ry * ry);
  if (lambda > 1) {
    const factor = Math.sqrt(lambda);
    rx *= factor;
    ry *= factor;
  }

  const sign = largeArcFlag === sweepFlag ? -1 : 1;
  const rxSq = rx * rx;
  const rySq = ry * ry;
  const x1PrimeSq = x1Prime * x1Prime;
  const y1PrimeSq = y1Prime * y1Prime;

  const num = rxSq * rySq - rxSq * y1PrimeSq - rySq * x1PrimeSq;
  const den = rxSq * y1PrimeSq + rySq * x1PrimeSq;
  const sq = Math.max(0, num / (den || 1));
  const coef = sign * Math.sqrt(sq);

  const cxPrime = (coef * (rx * y1Prime)) / ry;
  const cyPrime = (coef * -(ry * x1Prime)) / rx;

  const startVecX = (x1Prime - cxPrime) / rx;
  const startVecY = (y1Prime - cyPrime) / ry;
  const endVecX = (-x1Prime - cxPrime) / rx;
  const endVecY = (-y1Prime - cyPrime) / ry;

  let theta1 = Math.atan2(startVecY, startVecX);
  let deltaTheta = Math.atan2(endVecY, endVecX) - theta1;

  if (!sweepFlag && deltaTheta > 0) {
    deltaTheta -= 2 * Math.PI;
  } else if (sweepFlag && deltaTheta < 0) {
    deltaTheta += 2 * Math.PI;
  }

  const segments = Math.max(1, Math.ceil(Math.abs(deltaTheta) / (Math.PI / 2)));
  const deltaPerSeg = deltaTheta / segments;
  const results: Array<{ cp1x: number; cp1y: number; cp2x: number; cp2y: number; x: number; y: number }> = [];

  let curTheta = theta1;

  for (let i = 0; i < segments; i++) {
    const nextTheta = curTheta + deltaPerSeg;
    const halfDelta = deltaPerSeg / 2;
    const alpha = (Math.sin(deltaPerSeg) * (Math.sqrt(4 + 3 * Math.tan(halfDelta) * Math.tan(halfDelta)) - 1)) / 3;

    const cosCur = Math.cos(curTheta);
    const sinCur = Math.sin(curTheta);
    const cosNext = Math.cos(nextTheta);
    const sinNext = Math.sin(nextTheta);

    const cp1xLocal = cxPrime + rx * (cosCur - alpha * sinCur);
    const cp1yLocal = cyPrime + ry * (sinCur + alpha * cosCur);
    const cp2xLocal = cxPrime + rx * (cosNext + alpha * sinNext);
    const cp2yLocal = cyPrime + ry * (sinNext - alpha * cosNext);

    const nextXPrime = cxPrime + rx * cosNext;
    const nextYPrime = cyPrime + ry * sinNext;

    const cp1x = cosPhi * cp1xLocal - sinPhi * cp1yLocal + (x0 + x1) / 2;
    const cp1y = sinPhi * cp1xLocal + cosPhi * cp1yLocal + (y0 + y1) / 2;
    const cp2x = cosPhi * cp2xLocal - sinPhi * cp2yLocal + (x0 + x1) / 2;
    const cp2y = sinPhi * cp2xLocal + cosPhi * cp2yLocal + (y0 + y1) / 2;

    const segEndX = i === segments - 1 ? x1 : cosPhi * nextXPrime - sinPhi * nextYPrime + (x0 + x1) / 2;
    const segEndY = i === segments - 1 ? y1 : sinPhi * nextXPrime + cosPhi * nextYPrime + (y0 + y1) / 2;

    results.push({
      cp1x,
      cp1y,
      cp2x,
      cp2y,
      x: segEndX,
      y: segEndY,
    });

    curTheta = nextTheta;
  }

  return results;
}

/**
 * Parses raw SVG path string into normalised absolute geometric commands with optional scaling.
 */
export function parseSvgPath(d: string, scaleX: number = 1, scaleY: number = 1): SvgCommand[] {
  const tokens = tokeniseSvgPath(d);
  const commands: SvgCommand[] = [];

  let currentX = 0;
  let currentY = 0;
  let substartX = 0;
  let substartY = 0;
  let lastControlX = 0;
  let lastControlY = 0;
  let lastCommand = '';

  let idx = 0;
  while (idx < tokens.length) {
    const token = tokens[idx];
    if (typeof token !== 'string') {
      idx++;
      continue;
    }

    const cmd = token;
    idx++;

    const isRelative = cmd === cmd.toLowerCase() && cmd !== 'z';
    const upperCmd = cmd.toUpperCase();

    if (upperCmd === 'Z') {
      commands.push({ type: 'Z' });
      currentX = substartX;
      currentY = substartY;
      lastControlX = currentX;
      lastControlY = currentY;
      lastCommand = 'Z';
      continue;
    }

    while (idx < tokens.length && typeof tokens[idx] === 'number') {
      if (upperCmd === 'M') {
        const x = Number(tokens[idx++]);
        const y = Number(tokens[idx++]);
        const targetX = isRelative ? currentX + x : x;
        const targetY = isRelative ? currentY + y : y;

        if (commands.length === 0 || lastCommand === 'Z') {
          commands.push({
            type: 'M',
            x: targetX * scaleX,
            y: targetY * scaleY,
          });
          substartX = targetX;
          substartY = targetY;
        } else {
          commands.push({
            type: 'L',
            x: targetX * scaleX,
            y: targetY * scaleY,
          });
        }
        currentX = targetX;
        currentY = targetY;
        lastControlX = currentX;
        lastControlY = currentY;
        lastCommand = 'M';
      } else if (upperCmd === 'L') {
        const x = Number(tokens[idx++]);
        const y = Number(tokens[idx++]);
        currentX = isRelative ? currentX + x : x;
        currentY = isRelative ? currentY + y : y;
        commands.push({
          type: 'L',
          x: currentX * scaleX,
          y: currentY * scaleY,
        });
        lastControlX = currentX;
        lastControlY = currentY;
        lastCommand = 'L';
      } else if (upperCmd === 'H') {
        const x = Number(tokens[idx++]);
        currentX = isRelative ? currentX + x : x;
        commands.push({
          type: 'L',
          x: currentX * scaleX,
          y: currentY * scaleY,
        });
        lastControlX = currentX;
        lastControlY = currentY;
        lastCommand = 'H';
      } else if (upperCmd === 'V') {
        const y = Number(tokens[idx++]);
        currentY = isRelative ? currentY + y : y;
        commands.push({
          type: 'L',
          x: currentX * scaleX,
          y: currentY * scaleY,
        });
        lastControlX = currentX;
        lastControlY = currentY;
        lastCommand = 'V';
      } else if (upperCmd === 'C') {
        const cp1xRaw = Number(tokens[idx++]);
        const cp1yRaw = Number(tokens[idx++]);
        const cp2xRaw = Number(tokens[idx++]);
        const cp2yRaw = Number(tokens[idx++]);
        const xRaw = Number(tokens[idx++]);
        const yRaw = Number(tokens[idx++]);

        const cp1x = isRelative ? currentX + cp1xRaw : cp1xRaw;
        const cp1y = isRelative ? currentY + cp1yRaw : cp1yRaw;
        const cp2x = isRelative ? currentX + cp2xRaw : cp2xRaw;
        const cp2y = isRelative ? currentY + cp2yRaw : cp2yRaw;
        const x = isRelative ? currentX + xRaw : xRaw;
        const y = isRelative ? currentY + yRaw : yRaw;

        commands.push({
          type: 'C',
          cp1x: cp1x * scaleX,
          cp1y: cp1y * scaleY,
          cp2x: cp2x * scaleX,
          cp2y: cp2y * scaleY,
          x: x * scaleX,
          y: y * scaleY,
        });

        lastControlX = cp2x;
        lastControlY = cp2y;
        currentX = x;
        currentY = y;
        lastCommand = 'C';
      } else if (upperCmd === 'S') {
        const cp2xRaw = Number(tokens[idx++]);
        const cp2yRaw = Number(tokens[idx++]);
        const xRaw = Number(tokens[idx++]);
        const yRaw = Number(tokens[idx++]);

        const cp1x = lastCommand === 'C' || lastCommand === 'S' ? 2 * currentX - lastControlX : currentX;
        const cp1y = lastCommand === 'C' || lastCommand === 'S' ? 2 * currentY - lastControlY : currentY;
        const cp2x = isRelative ? currentX + cp2xRaw : cp2xRaw;
        const cp2y = isRelative ? currentY + cp2yRaw : cp2yRaw;
        const x = isRelative ? currentX + xRaw : xRaw;
        const y = isRelative ? currentY + yRaw : yRaw;

        commands.push({
          type: 'C',
          cp1x: cp1x * scaleX,
          cp1y: cp1y * scaleY,
          cp2x: cp2x * scaleX,
          cp2y: cp2y * scaleY,
          x: x * scaleX,
          y: y * scaleY,
        });

        lastControlX = cp2x;
        lastControlY = cp2y;
        currentX = x;
        currentY = y;
        lastCommand = 'S';
      } else if (upperCmd === 'Q') {
        const qxRaw = Number(tokens[idx++]);
        const qyRaw = Number(tokens[idx++]);
        const xRaw = Number(tokens[idx++]);
        const yRaw = Number(tokens[idx++]);

        const qx = isRelative ? currentX + qxRaw : qxRaw;
        const qy = isRelative ? currentY + qyRaw : qyRaw;
        const x = isRelative ? currentX + xRaw : xRaw;
        const y = isRelative ? currentY + yRaw : yRaw;

        const cp1x = currentX + (2 / 3) * (qx - currentX);
        const cp1y = currentY + (2 / 3) * (qy - currentY);
        const cp2x = x + (2 / 3) * (qx - x);
        const cp2y = y + (2 / 3) * (qy - y);

        commands.push({
          type: 'C',
          cp1x: cp1x * scaleX,
          cp1y: cp1y * scaleY,
          cp2x: cp2x * scaleX,
          cp2y: cp2y * scaleY,
          x: x * scaleX,
          y: y * scaleY,
        });

        lastControlX = qx;
        lastControlY = qy;
        currentX = x;
        currentY = y;
        lastCommand = 'Q';
      } else if (upperCmd === 'T') {
        const xRaw = Number(tokens[idx++]);
        const yRaw = Number(tokens[idx++]);

        const qx = lastCommand === 'Q' || lastCommand === 'T' ? 2 * currentX - lastControlX : currentX;
        const qy = lastCommand === 'Q' || lastCommand === 'T' ? 2 * currentY - lastControlY : currentY;
        const x = isRelative ? currentX + xRaw : xRaw;
        const y = isRelative ? currentY + yRaw : yRaw;

        const cp1x = currentX + (2 / 3) * (qx - currentX);
        const cp1y = currentY + (2 / 3) * (qy - currentY);
        const cp2x = x + (2 / 3) * (qx - x);
        const cp2y = y + (2 / 3) * (qy - y);

        commands.push({
          type: 'C',
          cp1x: cp1x * scaleX,
          cp1y: cp1y * scaleY,
          cp2x: cp2x * scaleX,
          cp2y: cp2y * scaleY,
          x: x * scaleX,
          y: y * scaleY,
        });

        lastControlX = qx;
        lastControlY = qy;
        currentX = x;
        currentY = y;
        lastCommand = 'T';
      } else if (upperCmd === 'A') {
        const rx = Number(tokens[idx++]);
        const ry = Number(tokens[idx++]);
        const rot = Number(tokens[idx++]);
        const largeArc = Boolean(tokens[idx++]);
        const sweep = Boolean(tokens[idx++]);
        const xRaw = Number(tokens[idx++]);
        const yRaw = Number(tokens[idx++]);
        const targetX = isRelative ? currentX + xRaw : xRaw;
        const targetY = isRelative ? currentY + yRaw : yRaw;

        const beziers = arcToBeziers(currentX, currentY, rx, ry, rot, largeArc, sweep, targetX, targetY);
        for (const b of beziers) {
          commands.push({
            type: 'C',
            cp1x: b.cp1x * scaleX,
            cp1y: b.cp1y * scaleY,
            cp2x: b.cp2x * scaleX,
            cp2y: b.cp2y * scaleY,
            x: b.x * scaleX,
            y: b.y * scaleY,
          });
        }

        currentX = targetX;
        currentY = targetY;
        lastControlX = currentX;
        lastControlY = currentY;
        lastCommand = 'A';
      } else {
        idx++;
      }
    }
  }

  return commands;
}

/**
 * Parses viewBox string formatted as "minX minY width height".
 */
function parseViewBoxDimensions(viewBox?: string): { width: number; height: number } | null {
  if (!viewBox) return null;
  const parts = viewBox.trim().split(/[\s,]+/).map(Number);
  if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
    return { width: parts[2], height: parts[3] };
  }
  return null;
}

/**
 * Draws an arbitrary SVG path or spline onto a PDF page using PDFium vector path primitives.
 *
 * @param engine The PDFium engine instance.
 * @param pageHandle Handle to the target PDF page.
 * @param options Vector styling, dimensions, transformation, and SVG path geometry.
 */
export function drawSvgPath(
  engine: PdfiumEngine,
  pageHandle: number,
  options: SvgPathOptions
): void {
  const mod = engine.getModule();
  const pageHeight = mod.FPDF_GetPageHeightF(pageHandle);
  const cropInfo = getPageCropInfo(engine, mod, pageHandle);
  const cropOffset = cropInfo.hasCropBox ? { cropX: cropInfo.cropLeft, cropY: cropInfo.cropBottom } : undefined;

  const targetWidth = Math.max(1, options.width || 100);
  const targetHeight = Math.max(1, options.height || 100);

  const vb = parseViewBoxDimensions(options.viewBox);
  const baseWidth = options.baseWidth ?? (vb ? vb.width : targetWidth);
  const baseHeight = options.baseHeight ?? (vb ? vb.height : targetHeight);

  const scaleX = baseWidth > 0 ? targetWidth / baseWidth : 1;
  const scaleY = baseHeight > 0 ? targetHeight / baseHeight : 1;

  const commands = parseSvgPath(options.svgPath, scaleX, scaleY);
  if (commands.length === 0) return;

  const firstCmd = commands[0];
  if (firstCmd.type !== 'M') return;

  const pathObj = mod.FPDFPageObj_CreateNewPath(firstCmd.x, firstCmd.y);
  if (!pathObj) return;

  for (let i = 1; i < commands.length; i++) {
    const cmd = commands[i];
    if (cmd.type === 'M') {
      if (typeof mod.FPDFPath_MoveTo === 'function') {
        mod.FPDFPath_MoveTo(pathObj, cmd.x, cmd.y);
      }
    } else if (cmd.type === 'L') {
      mod.FPDFPath_LineTo(pathObj, cmd.x, cmd.y);
    } else if (cmd.type === 'C') {
      if (typeof mod.FPDFPath_BezierTo === 'function') {
        mod.FPDFPath_BezierTo(pathObj, cmd.cp1x, cmd.cp1y, cmd.cp2x, cmd.cp2y, cmd.x, cmd.y);
      } else {
        mod.FPDFPath_LineTo(pathObj, cmd.x, cmd.y);
      }
    } else if (cmd.type === 'Z') {
      mod.FPDFPath_Close(pathObj);
    }
  }

  const fill = parseColor(options.fill || 'transparent');
  const stroke = parseColor(options.stroke || '#000000');
  const strokeWidth = options.strokeWidth || 0;
  const hasStroke = strokeWidth > 0 && stroke.a > 0;
  const hasFill = fill.a > 0;

  mod.FPDFPageObj_SetFillColor(pathObj, fill.r, fill.g, fill.b, fill.a);

  if (hasStroke) {
    mod.FPDFPageObj_SetStrokeColor(pathObj, stroke.r, stroke.g, stroke.b, stroke.a);
    mod.FPDFPageObj_SetStrokeWidth(pathObj, strokeWidth);

    const capInt = options.strokeLineCap === 'round' ? 1 : options.strokeLineCap === 'square' ? 2 : 0;
    if (typeof mod.FPDFPageObj_SetLineCap === 'function') {
      mod.FPDFPageObj_SetLineCap(pathObj, capInt);
    }

    const joinInt = options.strokeLineJoin === 'round' ? 1 : options.strokeLineJoin === 'bevel' ? 2 : 0;
    if (typeof mod.FPDFPageObj_SetLineJoin === 'function') {
      mod.FPDFPageObj_SetLineJoin(pathObj, joinInt);
    }
  }

  const fillMode = hasFill ? (options.fillRule === 'evenodd' || options.fillMode === 2 ? 2 : 1) : 0;
  mod.FPDFPath_SetDrawMode(pathObj, fillMode, hasStroke);

  const matrix = buildTransformMatrix(
    options.x,
    options.y,
    targetWidth,
    targetHeight,
    pageHeight,
    options.rotation || 0,
    options.flipX || false,
    options.flipY !== undefined ? !options.flipY : true,
    cropOffset
  );

  setPageObjectMatrix(engine, mod, pathObj, matrix);
  mod.FPDFPage_InsertObject(pageHandle, pathObj);
}
