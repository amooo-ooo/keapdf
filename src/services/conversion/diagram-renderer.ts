/**
 * Pure TypeScript Mermaid diagram parser and vector layout engine.
 * Renders flowcharts and sequence diagrams directly to PDF vector graphics without server round-trips.
 */

import { PDFPage, PDFFont, rgb } from 'pdf-lib';
import type { DiagramBlock } from './types';
import { sanitizeTextForWinAnsi, safeWidthOfText } from './winansi-sanitizer';

export interface DiagramNode {
  readonly id: string;
  readonly label: string;
  readonly shape: 'rect' | 'round' | 'diamond';
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiagramEdge {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
}

export interface FlowchartData {
  readonly direction: 'TD' | 'LR';
  readonly nodes: DiagramNode[];
  readonly edges: DiagramEdge[];
}

export interface SequenceMessage {
  readonly from: string;
  readonly to: string;
  readonly text: string;
  readonly isDashed: boolean;
}

export interface SequenceData {
  readonly participants: string[];
  readonly messages: SequenceMessage[];
}

/**
 * Parses a Mermaid flowchart or graph definition into structured nodes and edges.
 *
 * @param code Mermaid source text.
 * @return Parsed flowchart data with nodes and edges.
 */
export function parseMermaidFlowchart(code: string): FlowchartData {
  const lines = code
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('%%'));
  let direction: 'TD' | 'LR' = 'TD';

  const firstLine = lines[0] ?? '';
  if (/^(graph|flowchart)\s+(LR|RL)/i.test(firstLine)) {
    direction = 'LR';
  }

  const nodeMap = new Map<string, DiagramNode>();
  const edges: DiagramEdge[] = [];

  function getOrCreateNode(
    rawId: string,
    label?: string,
    shape: 'rect' | 'round' | 'diamond' = 'rect'
  ): DiagramNode {
    const id = rawId.trim();
    const cleanLabel = label ? label.replace(/^["']|["']$/g, '').trim() : undefined;
    const existing = nodeMap.get(id);
    if (existing) {
      if (cleanLabel && existing.label === id) {
        const updated: DiagramNode = {
          ...existing,
          label: cleanLabel,
          shape,
          width: Math.max(72, Math.min(180, cleanLabel.length * 6.5 + 24)),
        };
        nodeMap.set(id, updated);
        return updated;
      }
      return existing;
    }
    const resolvedLabel = cleanLabel ?? id;
    const node: DiagramNode = {
      id,
      label: resolvedLabel,
      shape,
      x: 0,
      y: 0,
      width: Math.max(72, Math.min(180, resolvedLabel.length * 6.5 + 24)),
      height: 30,
    };
    nodeMap.set(id, node);
    return node;
  }

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (/^(graph|flowchart|subgraph|end|style|classDef|class)\b/i.test(line)) continue;

    // Extract node definitions: A[Label], B(Label), C{Label}
    const nodeDefRegex = /([a-zA-Z0-9_-]+)\s*(\[|\(|\{)([^\]\)\}]*)(\]|\)|\})/g;
    let defMatch: RegExpExecArray | null;
    while ((defMatch = nodeDefRegex.exec(line)) !== null) {
      const id = defMatch[1];
      const openBracket = defMatch[2];
      const label = defMatch[3].trim();
      const shape: DiagramNode['shape'] =
        openBracket === '{' ? 'diamond' : openBracket === '(' ? 'round' : 'rect';
      getOrCreateNode(id, label, shape);
    }

    // Strip bracket definitions to simplify edge extraction
    const strippedLine = line.replace(/(\[[^\]]*\]|\([^\)]*\)|\{[^\}]*\})/g, '');

    // Extract edges: A --> B, A -->|Label| B, A --- B, A -.-> B, A ==> B
    const edgeRegex =
      /([a-zA-Z0-9_-]+)\s*(?:--+>|-\.+->|==+>|---+)\s*(?:\|([^|]*)\|\s*)?([a-zA-Z0-9_-]+)/g;
    let edgeMatch: RegExpExecArray | null;
    while ((edgeMatch = edgeRegex.exec(strippedLine)) !== null) {
      const from = edgeMatch[1].trim();
      const edgeLabel = edgeMatch[2]?.trim();
      const to = edgeMatch[3].trim();
      if (from && to) {
        getOrCreateNode(from);
        getOrCreateNode(to);
        edges.push({
          from,
          to,
          label: edgeLabel && edgeLabel.length > 0 ? edgeLabel : undefined,
        });
      }
    }
  }

  return {
    direction,
    nodes: Array.from(nodeMap.values()),
    edges,
  };
}

/**
 * Parses a Mermaid sequence diagram into participants and ordered messages.
 *
 * @param code Mermaid sequence diagram source text.
 * @return Parsed sequence participants and messages.
 */
export function parseMermaidSequence(code: string): SequenceData {
  const lines = code
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('%%'));

  const participants: string[] = [];
  const messages: SequenceMessage[] = [];

  function ensureParticipant(name: string): void {
    const clean = name.trim();
    if (clean.length > 0 && !participants.includes(clean)) {
      participants.push(clean);
    }
  }

  for (const line of lines) {
    if (/^sequenceDiagram\b/i.test(line)) continue;

    const partMatch = /^(?:participant|actor)\s+([a-zA-Z0-9_-]+)(?:\s+as\s+(.+))?$/i.exec(line);
    if (partMatch) {
      ensureParticipant(partMatch[1]);
      continue;
    }

    const msgMatch = /^([a-zA-Z0-9_-]+)\s*(--?>?>|--?[x\)]|->>|\ ->)\s*([a-zA-Z0-9_-]+)\s*:\s*(.*)$/.exec(
      line
    );
    if (msgMatch) {
      const from = msgMatch[1].trim();
      const arrow = msgMatch[2].trim();
      const to = msgMatch[3].trim();
      const text = msgMatch[4].trim();
      ensureParticipant(from);
      ensureParticipant(to);
      messages.push({
        from,
        to,
        text,
        isDashed: arrow.startsWith('--'),
      });
    }
  }

  return { participants, messages };
}

export interface DiagramDimensions {
  readonly totalHeight: number;
  readonly diagramKind: 'flowchart' | 'sequence' | 'generic';
}

/**
 * Computes the vertical height required to render a Mermaid diagram card.
 *
 * @param block DiagramBlock to measure.
 * @param printableWidth Available page width in points.
 * @return Computed height and diagram classification.
 */
export function measureDiagramBlock(block: DiagramBlock, printableWidth: number): DiagramDimensions {
  const trimmed = block.code.trim();
  const headerHeight = 22;
  const paddingY = 24;

  if (/^sequenceDiagram\b/i.test(trimmed)) {
    const seq = parseMermaidSequence(trimmed);
    const bodyHeight = Math.max(70, 44 + seq.messages.length * 28);
    return {
      totalHeight: headerHeight + bodyHeight + paddingY,
      diagramKind: 'sequence',
    };
  }

  if (/^(graph|flowchart)\b/i.test(trimmed)) {
    const flow = parseMermaidFlowchart(trimmed);
    const count = Math.max(1, flow.nodes.length);
    const bodyHeight =
      flow.direction === 'TD'
        ? Math.max(80, count * 50)
        : Math.max(80, Math.ceil((count * 120) / Math.max(200, printableWidth)) * 60);
    return {
      totalHeight: headerHeight + bodyHeight + paddingY,
      diagramKind: 'flowchart',
    };
  }

  const lineCount = Math.max(2, trimmed.split('\n').length);
  return {
    totalHeight: headerHeight + lineCount * 14 + paddingY,
    diagramKind: 'generic',
  };
}

/**
 * Renders a Mermaid diagram block as crisp vector shapes and typography onto a PDF page.
 *
 * @param page Target PDFPage instance.
 * @param pageHeight Page height in points.
 * @param startX Left margin coordinate in points.
 * @param cursorY Top-down vertical cursor coordinate in points.
 * @param printableWidth Available printable width in points.
 * @param block DiagramBlock definition.
 * @param fonts Embedded PDF fonts for label and badge rendering.
 * @return Total vertical height consumed by the diagram card.
 */
export function renderMermaidVectorDiagram(
  page: PDFPage,
  pageHeight: number,
  startX: number,
  cursorY: number,
  printableWidth: number,
  block: DiagramBlock,
  fonts: { regular: PDFFont; bold: PDFFont; mono: PDFFont }
): number {
  const metrics = measureDiagramBlock(block, printableWidth);
  const cardHeight = metrics.totalHeight;
  const pdfCardY = pageHeight - cursorY - cardHeight;

  // Draw card container background first (painter's algorithm)
  page.drawRectangle({
    x: startX,
    y: pdfCardY,
    width: printableWidth,
    height: cardHeight,
    color: rgb(0.976, 0.984, 0.992),
    borderColor: rgb(0.816, 0.843, 0.871),
    borderWidth: 0.75,
  });

  // Draw top banner bar
  const headerHeight = 22;
  const headerPdfY = pageHeight - cursorY - headerHeight;
  page.drawRectangle({
    x: startX,
    y: headerPdfY,
    width: printableWidth,
    height: headerHeight,
    color: rgb(0.945, 0.961, 0.976),
    borderColor: rgb(0.816, 0.843, 0.871),
    borderWidth: 0.5,
  });

  const bannerText =
    block.title ||
    (metrics.diagramKind === 'flowchart'
      ? 'Mermaid Flowchart'
      : metrics.diagramKind === 'sequence'
        ? 'Mermaid Sequence Diagram'
        : 'Mermaid Diagram');

  page.drawText(sanitizeTextForWinAnsi(bannerText), {
    x: startX + 10,
    y: headerPdfY + 6,
    size: 8.5,
    font: fonts.bold,
    color: rgb(0.18, 0.22, 0.3),
  });

  const innerTopY = cursorY + headerHeight + 14;
  const innerHeight = cardHeight - headerHeight - 28;

  if (metrics.diagramKind === 'flowchart') {
    const data = parseMermaidFlowchart(block.code);
    const count = data.nodes.length;
    if (count > 0) {
      if (data.direction === 'TD') {
        const stepY = innerHeight / count;
        data.nodes.forEach((node, idx) => {
          node.x = startX + (printableWidth - node.width) / 2;
          node.y = innerTopY + idx * stepY;
        });
      } else {
        const stepX = (printableWidth - 20) / count;
        data.nodes.forEach((node, idx) => {
          node.width = Math.min(node.width, Math.max(54, stepX - 14));
          node.x = startX + 10 + idx * stepX + (stepX - node.width) / 2;
          node.y = innerTopY + (innerHeight - node.height) / 2;
        });
      }

      // Draw directed connector edges behind nodes
      for (const edge of data.edges) {
        const fromNode = data.nodes.find((n) => n.id === edge.from);
        const toNode = data.nodes.find((n) => n.id === edge.to);
        if (fromNode && toNode) {
          const isVertical = data.direction === 'TD';
          const fromPdfX = isVertical
            ? fromNode.x + fromNode.width / 2
            : fromNode.x + fromNode.width;
          const fromPdfY = isVertical
            ? pageHeight - fromNode.y - fromNode.height
            : pageHeight - fromNode.y - fromNode.height / 2;
          const toPdfX = isVertical ? toNode.x + toNode.width / 2 : toNode.x;
          const toPdfY = isVertical
            ? pageHeight - toNode.y
            : pageHeight - toNode.y - toNode.height / 2;

          page.drawLine({
            start: { x: fromPdfX, y: fromPdfY },
            end: { x: toPdfX, y: toPdfY },
            thickness: 1.1,
            color: rgb(0.2, 0.45, 0.82),
          });

          // Terminal arrowhead marker
          page.drawRectangle({
            x: toPdfX - 2.5,
            y: toPdfY - 2.5,
            width: 5,
            height: 5,
            color: rgb(0.2, 0.45, 0.82),
          });

          if (edge.label) {
            const cleanEdgeLabel = sanitizeTextForWinAnsi(edge.label);
            const midX = (fromPdfX + toPdfX) / 2 + 4;
            const midY = (fromPdfY + toPdfY) / 2 - 2;
            page.drawText(cleanEdgeLabel, {
              x: midX,
              y: midY,
              size: 7.5,
              font: fonts.regular,
              color: rgb(0.32, 0.38, 0.46),
            });
          }
        }
      }

      // Draw vector node boxes and centred labels
      for (const node of data.nodes) {
        const nodePdfY = pageHeight - node.y - node.height;
        const fillColour =
          node.shape === 'diamond' ? rgb(0.95, 0.97, 1.0) : rgb(1, 1, 1);
        const borderColour =
          node.shape === 'diamond' ? rgb(0.18, 0.4, 0.78) : rgb(0.22, 0.42, 0.75);

        page.drawRectangle({
          x: node.x,
          y: nodePdfY,
          width: node.width,
          height: node.height,
          color: fillColour,
          borderColor: borderColour,
          borderWidth: 1,
        });

        const labelText = sanitizeTextForWinAnsi(node.label);
        const fontSize = 8.5;
        const measuredW = safeWidthOfText(fonts.bold, labelText, fontSize);
        const textX = node.x + Math.max(6, (node.width - measuredW) / 2);
        const textY = nodePdfY + (node.height - fontSize) / 2 + 1;

        page.drawText(labelText, {
          x: textX,
          y: textY,
          size: fontSize,
          font: fonts.bold,
          color: rgb(0.12, 0.16, 0.24),
        });
      }
    }
  } else if (metrics.diagramKind === 'sequence') {
    const data = parseMermaidSequence(block.code);
    const pCount = data.participants.length;
    if (pCount > 0) {
      const stepX = (printableWidth - 24) / pCount;
      const partCoords = new Map<string, number>();

      data.participants.forEach((name, idx) => {
        const boxW = Math.min(84, stepX - 8);
        const pX = startX + 12 + idx * stepX + (stepX - boxW) / 2;
        const centerX = pX + boxW / 2;
        partCoords.set(name, centerX);

        const partPdfY = pageHeight - innerTopY - 22;
        page.drawRectangle({
          x: pX,
          y: partPdfY,
          width: boxW,
          height: 22,
          color: rgb(1, 1, 1),
          borderColor: rgb(0.2, 0.42, 0.78),
          borderWidth: 1,
        });

        const cleanName = sanitizeTextForWinAnsi(name);
        const nameW = safeWidthOfText(fonts.bold, cleanName, 8);
        page.drawText(cleanName, {
          x: pX + Math.max(4, (boxW - nameW) / 2),
          y: partPdfY + 7,
          size: 8,
          font: fonts.bold,
          color: rgb(0.12, 0.18, 0.3),
        });

        // Draw vertical participant lifeline
        page.drawLine({
          start: { x: centerX, y: partPdfY },
          end: { x: centerX, y: pdfCardY + 12 },
          thickness: 0.6,
          color: rgb(0.75, 0.8, 0.86),
        });
      });

      // Draw horizontal message arrows
      let msgCurY = innerTopY + 38;
      for (const msg of data.messages) {
        const fromX = partCoords.get(msg.from);
        const toX = partCoords.get(msg.to);
        if (fromX !== undefined && toX !== undefined) {
          const msgPdfY = pageHeight - msgCurY;
          page.drawLine({
            start: { x: fromX, y: msgPdfY },
            end: { x: toX, y: msgPdfY },
            thickness: 1,
            color: msg.isDashed ? rgb(0.4, 0.48, 0.6) : rgb(0.18, 0.42, 0.8),
          });

          page.drawRectangle({
            x: toX - 2.5,
            y: msgPdfY - 2.5,
            width: 5,
            height: 5,
            color: rgb(0.18, 0.42, 0.8),
          });

          const cleanMsg = sanitizeTextForWinAnsi(msg.text);
          const msgW = safeWidthOfText(fonts.regular, cleanMsg, 7.5);
          const midX = (fromX + toX) / 2 - msgW / 2;
          page.drawText(cleanMsg, {
            x: Math.max(startX + 10, midX),
            y: msgPdfY + 3.5,
            size: 7.5,
            font: fonts.regular,
            color: rgb(0.15, 0.2, 0.28),
          });

          msgCurY += 28;
        }
      }
    }
  } else {
    const lines = block.code.split('\n');
    let textY = innerTopY + 4;
    for (const line of lines) {
      if (textY > cursorY + cardHeight - 16) break;
      page.drawText(sanitizeTextForWinAnsi(line), {
        x: startX + 14,
        y: pageHeight - textY - 9,
        size: 8,
        font: fonts.mono,
        color: rgb(0.2, 0.25, 0.35),
      });
      textY += 13;
    }
  }

  return cardHeight;
}
