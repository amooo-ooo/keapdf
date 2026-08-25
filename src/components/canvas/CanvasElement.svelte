<script lang="ts">
    import { useCanvasStore } from '../../stores/canvas.svelte';
    import { useCanvasActions } from '../../stores/canvas-actions';
    import type { CanvasElement, TextElementLine, TextSegment } from '../../stores/canvas-types';
    import { CheckSquare, Circle, ChevronDown, PenTool, Paperclip, StickyNote, X } from 'lucide-svelte';
    import { getCssFontFamily } from '../../services/font-loader';
    import { extractBaseFontFamily } from '../../services/pdf/font-charset-index';
    import { sanitizePdfText } from '../../services/pdf/utils';
    import { useSelection } from '../../stores/selection.svelte';
    import { useEditorStore } from '../../stores/editor.svelte';
    import { useEditorActions } from '../../stores/editor-actions';

    interface Props {
        element: CanvasElement;
        zoom: number;
        isSelected: boolean;
    }

    let { element, zoom, isSelected }: Props = $props();

    const canvasStore = useCanvasStore();
    const canvasActions = useCanvasActions();
    const selection = useSelection();
    const editorStore = useEditorStore();
    const editorActions = useEditorActions();

    const isEditing = $derived(canvasStore.editingElementId === element.id);
    let editableElementEl: HTMLDivElement | null = $state(null);

    function handlePointerDown(e: PointerEvent): void {
        if (isEditing) return;
        if (e.detail > 1) return;
        e.stopPropagation();
        selection.clear();
        editorActions.clearSelection(true);
        canvasStore.selectElement(element.id);
        
        const target = e.target as HTMLElement;
        const pageEl = target.closest('[data-page-element]') as HTMLElement;
        if (pageEl) {
            canvasActions.startDrag(element.id, e.clientX, e.clientY, pageEl, zoom, editorStore.getPageTransform(element.pageIndex));
        }
    }

    function handleClick(e: MouseEvent): void {
        if (isEditing) return;
        e.stopPropagation();
        selection.clear();
        editorActions.clearSelection(true);
        canvasStore.selectElement(element.id);
    }

    function handleDblClick(e: MouseEvent): void {
        e.stopPropagation();
        if (element.kind === 'text') {
            canvasActions.endDrag();
            canvasActions.endResize();
            canvasStore.editingElementId = element.id;
        }
    }

    function populateEditableContent(node: HTMLElement): void {
        if (element.kind !== 'text') return;
        node.innerHTML = '';
        if (element.lines && element.lines.length > 0) {
            for (let lIdx = 0; lIdx < element.lines.length; lIdx++) {
                const line = element.lines[lIdx];
                const lineDiv = document.createElement('div');
                lineDiv.className = 'canvas-text-line';
                lineDiv.dataset.lineIndex = String(lIdx);
                const lFontSize = line.fontSize || element.fontSize;
                lineDiv.style.fontSize = `${lFontSize * zoom}px`;
                lineDiv.style.textAlign = element.textAlign;
                lineDiv.style.lineHeight = line.lineHeight && line.fontSize ? String(line.lineHeight / line.fontSize) : (element.lineHeight ? String(element.lineHeight / element.fontSize) : '1.25');

                if (line.segments && line.segments.length > 0) {
                    for (let sIdx = 0; sIdx < line.segments.length; sIdx++) {
                        const seg = line.segments[sIdx];
                        const spanEl = document.createElement('span');
                        spanEl.dataset.segmentIndex = String(sIdx);
                        const sFontSize = seg.fontSize || line.fontSize || element.fontSize;
                        spanEl.style.fontSize = `${sFontSize * zoom}px`;
                        spanEl.style.fontFamily = getCssFontFamily(seg.rawFontFamily || seg.fontFamily || element.fontFamily, extractBaseFontFamily);
                        spanEl.style.color = seg.color || element.color;
                        spanEl.style.fontWeight = seg.fontWeight || element.fontWeight;
                        spanEl.style.fontStyle = seg.fontStyle || element.fontStyle;
                        spanEl.style.verticalAlign = 'baseline';
                        spanEl.textContent = seg.text;
                        lineDiv.appendChild(spanEl);
                    }
                } else {
                    const spanEl = document.createElement('span');
                    spanEl.dataset.segmentIndex = '0';
                    spanEl.style.fontSize = `${lFontSize * zoom}px`;
                    spanEl.style.fontFamily = getCssFontFamily(element.rawFontFamily || element.fontFamily, extractBaseFontFamily);
                    spanEl.style.color = element.color;
                    spanEl.style.fontWeight = element.fontWeight;
                    spanEl.style.fontStyle = element.fontStyle;
                    spanEl.style.verticalAlign = 'baseline';
                    spanEl.textContent = line.text || '';
                    lineDiv.appendChild(spanEl);
                }
                node.appendChild(lineDiv);
            }
        } else if (element.segments && element.segments.length > 0) {
            for (let sIdx = 0; sIdx < element.segments.length; sIdx++) {
                const seg = element.segments[sIdx];
                const spanEl = document.createElement('span');
                spanEl.dataset.segmentIndex = String(sIdx);
                const sFontSize = seg.fontSize || element.fontSize;
                spanEl.style.fontSize = `${sFontSize * zoom}px`;
                spanEl.style.fontFamily = getCssFontFamily(seg.rawFontFamily || seg.fontFamily || element.fontFamily, extractBaseFontFamily);
                spanEl.style.color = seg.color || element.color;
                spanEl.style.fontWeight = seg.fontWeight || element.fontWeight;
                spanEl.style.fontStyle = seg.fontStyle || element.fontStyle;
                spanEl.style.verticalAlign = 'baseline';
                spanEl.textContent = seg.text;
                node.appendChild(spanEl);
            }
        } else {
            node.innerText = element.text;
        }
    }

    function handleBlur(): void {
        if (!isEditing || element.kind !== 'text') return;
        if (canvasStore.editingElementId === element.id) {
            canvasStore.editingElementId = null;
        }
        if (!editableElementEl) return;

        const rawText = editableElementEl.innerText ?? editableElementEl.textContent ?? '';
        const fullText = sanitizePdfText(rawText);

        const measuredHeight = Math.ceil(editableElementEl.scrollHeight / zoom);
        const newHeight = measuredHeight > element.height ? measuredHeight : element.height;

        const lineNodes = Array.from(editableElementEl.querySelectorAll<HTMLDivElement>('.canvas-text-line'));
        if (lineNodes.length > 0) {
            const updatedLines: TextElementLine[] = [];
            const allSegments: TextSegment[] = [];

            for (let lIdx = 0; lIdx < lineNodes.length; lIdx++) {
                const lineNode = lineNodes[lIdx];
                const origLine = element.lines && element.lines[lIdx] ? element.lines[lIdx] : undefined;
                const lineFontSize = origLine?.fontSize || element.fontSize;
                const lineText = sanitizePdfText(lineNode.innerText ?? lineNode.textContent ?? '');

                const segNodes = Array.from(lineNode.querySelectorAll<HTMLSpanElement>('span[data-segment-index]'));
                const lineSegments: TextSegment[] = [];

                if (segNodes.length > 0) {
                    for (let sIdx = 0; sIdx < segNodes.length; sIdx++) {
                        const segNode = segNodes[sIdx];
                        const origSegIdx = parseInt(segNode.dataset.segmentIndex || `${sIdx}`, 10);
                        const origSeg = origLine?.segments?.[origSegIdx];
                        const segText = sanitizePdfText(segNode.innerText ?? segNode.textContent ?? '');
                        if (!segText) continue;

                        const seg: TextSegment = {
                            text: segText,
                            fontSize: origSeg?.fontSize || lineFontSize,
                            fontFamily: origSeg?.fontFamily || element.fontFamily,
                            rawFontFamily: origSeg?.rawFontFamily || element.rawFontFamily,
                            color: origSeg?.color || element.color,
                            fontWeight: origSeg?.fontWeight || element.fontWeight,
                            fontStyle: origSeg?.fontStyle || element.fontStyle,
                            charCount: segText.length,
                        };
                        lineSegments.push(seg);
                        allSegments.push(seg);
                    }
                }

                if (lineSegments.length === 0) {
                    const defaultSeg: TextSegment = {
                        text: lineText,
                        fontSize: lineFontSize,
                        fontFamily: origLine?.segments?.[0]?.fontFamily || element.fontFamily,
                        rawFontFamily: origLine?.segments?.[0]?.rawFontFamily || element.rawFontFamily,
                        color: origLine?.segments?.[0]?.color || element.color,
                        fontWeight: origLine?.segments?.[0]?.fontWeight || element.fontWeight,
                        fontStyle: origLine?.segments?.[0]?.fontStyle || element.fontStyle,
                        charCount: lineText.length,
                    };
                    lineSegments.push(defaultSeg);
                    allSegments.push(defaultSeg);
                }

                updatedLines.push({
                    text: lineText,
                    fontSize: lineFontSize,
                    lineHeight: origLine?.lineHeight,
                    segments: lineSegments,
                });
            }

            canvasStore.updateElement(element.id, {
                text: fullText,
                lines: updatedLines,
                segments: allSegments,
                height: newHeight,
            });
            return;
        }

        const textLines = fullText.split(/\r?\n/);
        const updatedLines: TextElementLine[] = textLines.map((lineStr, idx) => {
            const originalLine = element.lines && element.lines[idx] ? element.lines[idx] : undefined;
            const lineFontSize = originalLine?.fontSize || element.fontSize;
            const defaultSeg: TextSegment = {
                text: lineStr,
                fontSize: lineFontSize,
                fontFamily: originalLine?.segments?.[0]?.fontFamily || element.fontFamily,
                rawFontFamily: originalLine?.segments?.[0]?.rawFontFamily || element.rawFontFamily,
                color: originalLine?.segments?.[0]?.color || element.color,
                fontWeight: originalLine?.segments?.[0]?.fontWeight || element.fontWeight,
                fontStyle: originalLine?.segments?.[0]?.fontStyle || element.fontStyle,
                charCount: lineStr.length,
            };
            return {
                text: lineStr,
                fontSize: lineFontSize,
                lineHeight: originalLine?.lineHeight,
                segments: originalLine?.segments && originalLine.segments.length > 0 ? originalLine.segments : [defaultSeg],
            };
        });

        canvasStore.updateElement(element.id, {
            text: fullText,
            lines: updatedLines,
            segments: updatedLines.flatMap((l) => l.segments),
            height: newHeight,
        });
    }

    function handleEditKeyDown(e: KeyboardEvent): void {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.stopPropagation();
            e.preventDefault();
            handleBlur();
        } else if (e.key === 'Enter' && e.shiftKey) {
            e.stopPropagation();
            e.preventDefault();
            let inserted = false;
            try {
                inserted = document.execCommand('insertLineBreak');
            } catch {
                inserted = false;
            }
            if (!inserted) {
                const sel = window.getSelection();
                if (sel && sel.rangeCount > 0) {
                    const range = sel.getRangeAt(0);
                    range.deleteContents();
                    const br = document.createElement('br');
                    range.insertNode(br);
                    range.setStartAfter(br);
                    range.setEndAfter(br);
                    sel.removeAllRanges();
                    sel.addRange(range);
                }
            }
            if (editableElementEl) {
                editableElementEl.dispatchEvent(new Event('input', { bubbles: true }));
            }
        } else if (e.key === 'Escape') {
            e.stopPropagation();
            e.preventDefault();
            if (canvasStore.editingElementId === element.id) {
                canvasStore.editingElementId = null;
            }
        }
    }

    function focusContentEditable(node: HTMLElement) {
        if (element.kind !== 'text') return;
        populateEditableContent(node);
        queueMicrotask(() => {
            node.focus();
            const sel = window.getSelection();
            if (sel) {
                const range = document.createRange();
                range.selectNodeContents(node);
                sel.removeAllRanges();
                sel.addRange(range);
            }
        });
    }
</script>

<div
    class="canvas-element-container absolute pointer-events-auto flex {element.kind === 'text' ? 'items-start overflow-visible' : (element.kind === 'note' ? 'items-stretch overflow-visible' : 'items-center justify-center overflow-hidden')} {isSelected ? 'canvas-element-selected' : ''}"
    style="
        left: {element.x * zoom}px;
        top: {element.y * zoom}px;
        width: {element.width * zoom}px;
        height: {element.height * zoom}px;
        transform: rotate({element.rotation}deg) scaleX({element.flipX ? -1 : 1}) scaleY({element.flipY ? -1 : 1});
        cursor: {element.locked ? 'default' : (isEditing ? 'text' : 'move')};
        opacity: {element.kind === 'shape' || element.kind === 'image' || element.kind === 'path' ? element.opacity : 1};
    "
    onpointerdown={handlePointerDown}
    onclick={handleClick}
    ondblclick={handleDblClick}
    onkeydown={(e) => { if (e.key === 'Enter' && !isEditing) { e.stopPropagation(); selection.clear(); editorActions.clearSelection(true); canvasStore.selectElement(element.id); } }}
    role="button"
    tabindex="0"
>
    {#if element.kind === 'text'}
        {#if isEditing}
            <div 
                bind:this={editableElementEl}
                contenteditable="true"
                role="textbox"
                tabindex="0"
                aria-multiline="true"
                onblur={handleBlur}
                onkeydown={handleEditKeyDown}
                class="w-full flex flex-col outline-none border border-[#0D99FF] ring-2 ring-[#0D99FF]/25 rounded-[2px] select-text cursor-text p-[1px]"
                style="
                    text-align: {element.textAlign};
                    line-height: {element.lineHeight ? (element.lineHeight / element.fontSize) : 1.25};
                    font-size: {element.fontSize * zoom}px;
                    font-family: {getCssFontFamily(element.rawFontFamily || element.fontFamily, extractBaseFontFamily)};
                    color: {element.color};
                    font-weight: {element.fontWeight};
                    font-style: {element.fontStyle};
                    white-space: pre-wrap;
                    word-break: break-word;
                "
                use:focusContentEditable
            ></div>
        {:else}
            <div 
                class="w-full flex flex-col pointer-events-none select-none"
                style="
                    text-align: {element.textAlign};
                    line-height: {element.lineHeight ? (element.lineHeight / element.fontSize) : 1.25};
                    font-size: {element.fontSize * zoom}px;
                    font-family: {getCssFontFamily(element.rawFontFamily || element.fontFamily, extractBaseFontFamily)};
                    color: {element.color};
                    background-color: {element.backgroundColor || 'transparent'};
                    font-weight: {element.fontWeight};
                    font-style: {element.fontStyle};
                    white-space: pre-wrap;
                    word-break: break-word;
                "
            >
                {#if element.lines && element.lines.length > 0}
                    {#each element.lines as line, lineIdx}
                        <div 
                            class="canvas-text-line"
                            data-line-index={lineIdx}
                            style="
                                display: block;
                                text-align: {element.textAlign};
                                line-height: {line.lineHeight && line.fontSize ? (line.lineHeight / line.fontSize) : (element.lineHeight ? element.lineHeight / element.fontSize : 1.25)};
                                font-size: {(line.fontSize || element.fontSize) * zoom}px;
                            "
                        >{#if line.segments && line.segments.length > 0}{#each line.segments as segment, segIdx}<span data-segment-index={segIdx} style="font-size: {(segment.fontSize || line.fontSize || element.fontSize) * zoom}px; font-family: {getCssFontFamily(segment.rawFontFamily || segment.fontFamily || element.fontFamily, extractBaseFontFamily)}; color: {segment.color || element.color}; font-weight: {segment.fontWeight || element.fontWeight}; font-style: {segment.fontStyle || element.fontStyle}; vertical-align: baseline;">{segment.text}</span>{/each}{:else}<span data-segment-index="0" style="font-size: {(line.fontSize || element.fontSize) * zoom}px; font-family: {getCssFontFamily(element.rawFontFamily || element.fontFamily, extractBaseFontFamily)}; color: {element.color}; font-weight: {element.fontWeight}; font-style: {element.fontStyle}; vertical-align: baseline;">{line.text || ''}</span>{/if}</div>
                    {/each}
                {:else if element.segments && element.segments.length > 0}
                    <div 
                        class="w-full"
                        style="
                            text-align: {element.textAlign};
                            line-height: {element.lineHeight ? (element.lineHeight / element.fontSize) : 1.25};
                        "
                    >{#each element.segments as segment, segIdx}<span data-segment-index={segIdx} style="font-size: {(segment.fontSize || element.fontSize) * zoom}px; font-family: {getCssFontFamily(segment.rawFontFamily || segment.fontFamily || element.fontFamily, extractBaseFontFamily)}; color: {segment.color || element.color}; font-weight: {segment.fontWeight || element.fontWeight}; font-style: {segment.fontStyle || element.fontStyle}; vertical-align: baseline;">{segment.text}</span>{/each}</div>
                {:else}
                    <span 
                        style="
                            font-size: {element.fontSize * zoom}px;
                            font-family: {getCssFontFamily(element.rawFontFamily || element.fontFamily, extractBaseFontFamily)};
                            color: {element.color};
                            font-weight: {element.fontWeight};
                            font-style: {element.fontStyle};
                            text-align: {element.textAlign};
                            display: inline-block;
                            line-height: {element.lineHeight ? (element.lineHeight / element.fontSize) : 1.25};
                        "
                    >{element.text}</span>
                {/if}
            </div>
        {/if}
    {:else if element.kind === 'shape'}
        {#if element.variant === 'rectangle'}
            <div 
                class="w-full h-full"
                style="background-color: {element.fill}; border: {element.strokeWidth * zoom}px solid {element.stroke}; {element.isHighlight ? 'mix-blend-mode: multiply;' : ''}"
            ></div>
        {:else if element.variant === 'circle'}
            <div 
                class="w-full h-full rounded-full"
                style="background-color: {element.fill}; border: {element.strokeWidth * zoom}px solid {element.stroke};"
            ></div>
        {:else if element.variant === 'line'}
            <svg class="w-full h-full overflow-visible" preserveAspectRatio="none">
                <line x1="0" y1="50%" x2="100%" y2="50%" stroke={element.stroke} stroke-width={element.strokeWidth * zoom} />
            </svg>
        {:else if element.variant === 'arrow'}
            <svg class="w-full h-full overflow-visible" preserveAspectRatio="none">
                <defs>
                    <marker id="arrowhead-{element.id}" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                        <polygon points="0 0, 10 3.5, 0 7" fill={element.stroke} />
                    </marker>
                </defs>
                <line x1="0" y1="50%" x2="100%" y2="50%" stroke={element.stroke} stroke-width={element.strokeWidth * zoom} marker-end="url(#arrowhead-{element.id})" />
            </svg>
        {/if}
    {:else if element.kind === 'image'}
        {#if element.src}
            <img src={element.src} alt="Placed element" draggable="false" style="display: block; width: 100%; height: 100%; max-width: none; max-height: none; object-fit: {element.objectFit};" />
        {:else}
            <div class="w-full h-full bg-muted flex items-center justify-center text-muted-foreground border border-dashed border-border text-xs">
                No image
            </div>
        {/if}
    {:else if element.kind === 'form-field'}
        <div class="w-full h-full bg-slate-100/60 border border-slate-500 text-slate-900 flex items-center px-1 text-xs">
            {#if element.variant === 'text-input'}
                {#if element.placeholder}
                    <div class="w-full truncate text-slate-500 italic">{element.placeholder}</div>
                {:else}
                    <div class="w-full truncate">{element.label || 'Text Input'}</div>
                {/if}
            {:else if element.variant === 'checkbox'}
                <CheckSquare class="w-4 h-4 mr-1 shrink-0 text-slate-700" />
                <div class="truncate">{element.label || 'Checkbox'}</div>
            {:else if element.variant === 'radio'}
                <Circle class="w-4 h-4 mr-1 shrink-0 text-slate-700" />
                <div class="truncate">{element.label || 'Radio'}</div>
            {:else if element.variant === 'dropdown'}
                <div class="w-full flex items-center justify-between truncate">
                    {#if element.placeholder}
                        <span class="text-slate-500 italic">{element.placeholder}</span>
                    {:else}
                        <span>{element.label || 'Dropdown'}</span>
                    {/if}
                    <ChevronDown class="w-4 h-4 shrink-0 text-slate-700" />
                </div>
            {:else if element.variant === 'signature'}
                <div class="w-full h-full border border-dashed border-slate-400 flex items-center justify-center relative bg-white/50">
                    <PenTool class="w-4 h-4 absolute left-1 opacity-50 shrink-0" />
                    <span>{element.label || 'Signature'}</span>
                </div>
            {:else if element.variant === 'attachment'}
                <Paperclip class="w-4 h-4 mr-1 shrink-0 text-slate-700" />
                <div class="truncate">{element.label || 'Attachment'}</div>
            {/if}
        </div>
    {:else if element.kind === 'path'}
        <svg 
            class="w-full h-full overflow-visible" 
            style={element.isHighlight ? "mix-blend-mode: multiply;" : ""}
        >
            <path
                d={element.points && element.points.length > 0 ? `M ${element.points.map(p => `${(p.x - element.x) * zoom},${(p.y - element.y) * zoom}`).join(' L ')}` : ''}
                fill="none"
                stroke={element.stroke}
                stroke-width={element.strokeWidth * zoom}
                stroke-linecap="round"
                stroke-linejoin="round"
            />
        </svg>
    {:else if element.kind === 'note'}
        <div 
            class="w-full h-full rounded shadow-md border flex flex-col overflow-hidden text-xs select-none"
            style="background-color: {element.color || '#fef08a'}; border-color: rgba(0,0,0,0.15);"
        >
            <div class="flex items-center justify-between px-2 py-1 bg-black/5 border-b border-black/10 cursor-move">
                <div class="flex items-center gap-1 font-semibold text-[11px] text-foreground/80 truncate">
                    <StickyNote class="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span>{element.author || 'Note'}</span>
                </div>
                <button
                    type="button"
                    class="h-4 w-4 rounded hover:bg-black/10 flex items-center justify-center text-foreground/60 hover:text-foreground cursor-pointer"
                    onclick={(e) => {
                        e.stopPropagation();
                        canvasStore.removeElement(element.id);
                    }}
                    title="Delete Note"
                >
                    <X class="w-3 h-3" />
                </button>
            </div>
            <div class="flex-1 p-1.5 flex flex-col min-h-0">
                <textarea
                    value={element.text}
                    oninput={(e) => {
                        const target = e.target as HTMLTextAreaElement;
                        canvasStore.updateElement(element.id, { text: target.value });
                    }}
                    onpointerdown={(e) => e.stopPropagation()}
                    onclick={(e) => e.stopPropagation()}
                    placeholder="Write a comment..."
                    class="w-full h-full bg-transparent resize-none outline-none text-[11px] text-foreground placeholder:text-foreground/40 leading-relaxed"
                ></textarea>
            </div>
        </div>
    {/if}
</div>
