import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFArray,
  PDFRef,
  PDFString,
  PDFHexString,
} from 'pdf-lib';
import type {
  SanitizeOptions,
  SanitizeSummary,
  SanitizationInspection,
} from '../../../core/types';

/**
 * Standard DocInfo dictionary keys.
 */
const STANDARD_DOC_INFO_KEYS = [
  'Title',
  'Author',
  'Subject',
  'Keywords',
  'Creator',
  'Producer',
  'CreationDate',
  'ModDate',
  'Trapped',
];

/**
 * Inspects a binary PDF buffer for sensitive metadata, embedded scripts,
 * annotations, attachments, bookmarks, and private application data.
 *
 * @param pdfBytes The binary buffer of the PDF to inspect.
 * @return A promise resolving to the inspection summary.
 */
export async function inspectPdfForSanitization(
  pdfBytes: Uint8Array | ArrayBuffer
): Promise<SanitizationInspection> {
  const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });

  const metadataKeys: string[] = [];
  let metadataCount = 0;

  // 1. Inspect Info Dictionary
  if (pdfDoc.context.trailerInfo.Info) {
    const infoDict = pdfDoc.context.lookup(pdfDoc.context.trailerInfo.Info);
    if (infoDict instanceof PDFDict) {
      for (const [keyName, val] of infoDict.entries()) {
        const keyStr = keyName.asString().replace(/^\//, '');
        let decodedStr = '';
        if (val instanceof PDFString || val instanceof PDFHexString) {
          decodedStr = val.decodeText().trim();
        } else if (val instanceof PDFName) {
          decodedStr = val.asString().trim();
        } else if (val !== undefined && val !== null) {
          decodedStr = val.toString().trim();
        }

        if (
          decodedStr.length > 0 &&
          decodedStr !== '()' &&
          decodedStr !== '<>' &&
          decodedStr !== '[]'
        ) {
          metadataKeys.push(keyStr);
          metadataCount++;
        }
      }
    }
  }

  // 2. Inspect XMP Metadata Stream in Catalog
  const hasXmpMetadata = pdfDoc.catalog.has(PDFName.of('Metadata'));

  // 3. Inspect Embedded File Attachments
  let attachmentCount = 0;
  if (pdfDoc.catalog.has(PDFName.of('AF'))) {
    const af = pdfDoc.context.lookup(pdfDoc.catalog.get(PDFName.of('AF')));
    if (af instanceof PDFArray) {
      attachmentCount += af.size();
    }
  }
  const namesRef = pdfDoc.catalog.get(PDFName.of('Names'));
  if (namesRef) {
    const namesDict = pdfDoc.context.lookup(namesRef);
    if (namesDict instanceof PDFDict && namesDict.has(PDFName.of('EmbeddedFiles'))) {
      const embFiles = pdfDoc.context.lookup(namesDict.get(PDFName.of('EmbeddedFiles')));
      if (embFiles instanceof PDFDict && embFiles.has(PDFName.of('Names'))) {
        const namesArray = pdfDoc.context.lookup(embFiles.get(PDFName.of('Names')));
        if (namesArray instanceof PDFArray) {
          attachmentCount += Math.floor(namesArray.size() / 2);
        }
      } else {
        attachmentCount += 1;
      }
    }
  }

  // 4. Inspect Document & Object JavaScript / Actions
  let hasJavascript = false;
  if (
    pdfDoc.catalog.has(PDFName.of('OpenAction')) ||
    pdfDoc.catalog.has(PDFName.of('AA')) ||
    pdfDoc.catalog.has(PDFName.of('JavaScript'))
  ) {
    hasJavascript = true;
  }
  if (namesRef) {
    const namesDict = pdfDoc.context.lookup(namesRef);
    if (namesDict instanceof PDFDict && namesDict.has(PDFName.of('JavaScript'))) {
      hasJavascript = true;
    }
  }

  // 5. Inspect Bookmarks / Outlines
  let bookmarkCount = 0;
  const outlinesRef = pdfDoc.catalog.get(PDFName.of('Outlines'));
  if (outlinesRef) {
    const outlinesDict = pdfDoc.context.lookup(outlinesRef);
    if (outlinesDict instanceof PDFDict) {
      const countVal = outlinesDict.get(PDFName.of('Count'));
      if (countVal !== undefined) {
        const rawCount = Number(countVal.toString());
        bookmarkCount = isNaN(rawCount) ? 1 : Math.abs(rawCount);
      } else {
        bookmarkCount = 1;
      }
    }
  }

  // 6. Inspect Form Fields
  let formFieldCount = 0;
  const acroFormRef = pdfDoc.catalog.get(PDFName.of('AcroForm'));
  if (acroFormRef) {
    const acroFormDict = pdfDoc.context.lookup(acroFormRef);
    if (acroFormDict instanceof PDFDict && acroFormDict.has(PDFName.of('Fields'))) {
      const fieldsArray = pdfDoc.context.lookup(acroFormDict.get(PDFName.of('Fields')));
      if (fieldsArray instanceof PDFArray) {
        formFieldCount = fieldsArray.size();
      }
    }
  }

  // 7. Inspect PieceInfo (Catalog level)
  let hasPieceInfo = pdfDoc.catalog.has(PDFName.of('PieceInfo'));

  // 8. Inspect StructTreeRoot & MarkInfo
  const hasStructTree =
    pdfDoc.catalog.has(PDFName.of('StructTreeRoot')) ||
    pdfDoc.catalog.has(PDFName.of('MarkInfo'));

  // 9. Inspect Per-Page Elements (Annotations, Links, Thumbnails, Page JS)
  let annotationCount = 0;
  let linkCount = 0;
  let thumbnailCount = 0;

  const pageCount = pdfDoc.getPageCount();
  for (let i = 0; i < pageCount; i++) {
    const page = pdfDoc.getPage(i);

    if (page.node.has(PDFName.of('PieceInfo'))) {
      hasPieceInfo = true;
    }
    if (page.node.has(PDFName.of('Thumb'))) {
      thumbnailCount++;
    }
    if (page.node.has(PDFName.of('AA'))) {
      hasJavascript = true;
    }

    const annotsRef = page.node.get(PDFName.of('Annots'));
    if (annotsRef) {
      const annotsArray = pdfDoc.context.lookup(annotsRef);
      if (annotsArray instanceof PDFArray) {
        for (let j = 0; j < annotsArray.size(); j++) {
          const itemRef = annotsArray.get(j);
          const annotDict = pdfDoc.context.lookup(itemRef);
          if (annotDict instanceof PDFDict) {
            const subtype = annotDict.get(PDFName.of('Subtype'));
            const subtypeStr = subtype instanceof PDFName ? subtype.asString() : '';
            if (subtypeStr === '/Link') {
              linkCount++;
            } else if (subtypeStr === '/Widget') {
              if (formFieldCount === 0) {
                formFieldCount++;
              }
            } else {
              annotationCount++;
            }
          }
        }
      }
    }
  }

  return {
    metadataCount,
    metadataKeys,
    hasXmpMetadata,
    attachmentCount,
    hasJavascript,
    annotationCount,
    linkCount,
    formFieldCount,
    bookmarkCount,
    hasPieceInfo,
    thumbnailCount,
    hasStructTree,
  };
}

/**
 * Sanitizes a PDF document by purging selected sensitive metadata,
 * attachments, scripts, annotations, links, form fields, outlines,
 * private application data, and thumbnail dictionaries.
 *
 * @param pdfBytes The input binary PDF buffer.
 * @param options User-selected sanitization options.
 * @return A promise resolving to the sanitized bytes and a summary of purged items.
 */
export async function sanitizePdf(
  pdfBytes: Uint8Array | ArrayBuffer,
  options: SanitizeOptions
): Promise<{ sanitizedBytes: Uint8Array; summary: SanitizeSummary }> {
  const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });

  const summary: SanitizeSummary = {
    metadataCleared: false,
    xmpCleared: false,
    attachmentsRemoved: 0,
    javascriptActionsRemoved: 0,
    annotationsRemoved: 0,
    linksRemoved: 0,
    formFieldsRemoved: 0,
    bookmarksRemoved: false,
    pieceInfoRemoved: 0,
    thumbnailsRemoved: 0,
    structTreeRemoved: false,
  };

  // 1. Purge DocInfo Metadata
  if (options.removeMetadata) {
    if (pdfDoc.context.trailerInfo.Info) {
      const infoRef = pdfDoc.context.trailerInfo.Info;
      const infoDict = pdfDoc.context.lookup(infoRef);
      if (infoDict instanceof PDFDict) {
        const keys = infoDict.keys();
        for (const k of keys) {
          infoDict.delete(k);
        }
      }
      if (infoRef instanceof PDFRef) {
        pdfDoc.context.delete(infoRef);
      }
      delete (pdfDoc.context.trailerInfo as Record<string, unknown>).Info;
    }
    for (const key of STANDARD_DOC_INFO_KEYS) {
      if (key === 'Keywords') {
        pdfDoc.setKeywords([]);
      } else if (key === 'Title') {
        pdfDoc.setTitle('');
      } else if (key === 'Author') {
        pdfDoc.setAuthor('');
      } else if (key === 'Subject') {
        pdfDoc.setSubject('');
      } else if (key === 'Creator') {
        pdfDoc.setCreator('');
      } else if (key === 'Producer') {
        pdfDoc.setProducer('');
      }
    }
    summary.metadataCleared = true;
  }

  // 2. Purge XMP Metadata
  if (options.removeXmpMetadata) {
    if (pdfDoc.catalog.has(PDFName.of('Metadata'))) {
      pdfDoc.catalog.delete(PDFName.of('Metadata'));
      summary.xmpCleared = true;
    }
  }

  // 3. Purge File Attachments
  if (options.removeAttachments) {
    if (pdfDoc.catalog.has(PDFName.of('AF'))) {
      const af = pdfDoc.context.lookup(pdfDoc.catalog.get(PDFName.of('AF')));
      if (af instanceof PDFArray) {
        summary.attachmentsRemoved += af.size();
      }
      pdfDoc.catalog.delete(PDFName.of('AF'));
    }

    const namesRef = pdfDoc.catalog.get(PDFName.of('Names'));
    if (namesRef) {
      const namesDict = pdfDoc.context.lookup(namesRef);
      if (namesDict instanceof PDFDict && namesDict.has(PDFName.of('EmbeddedFiles'))) {
        const embFiles = pdfDoc.context.lookup(namesDict.get(PDFName.of('EmbeddedFiles')));
        if (embFiles instanceof PDFDict && embFiles.has(PDFName.of('Names'))) {
          const namesArray = pdfDoc.context.lookup(embFiles.get(PDFName.of('Names')));
          if (namesArray instanceof PDFArray) {
            summary.attachmentsRemoved += Math.max(1, Math.floor(namesArray.size() / 2));
          }
        } else {
          summary.attachmentsRemoved += 1;
        }
        namesDict.delete(PDFName.of('EmbeddedFiles'));
      }
    }
  }

  // 4. Purge JavaScript & Interactive Actions
  if (options.removeJavascript) {
    if (pdfDoc.catalog.has(PDFName.of('OpenAction'))) {
      pdfDoc.catalog.delete(PDFName.of('OpenAction'));
      summary.javascriptActionsRemoved++;
    }
    if (pdfDoc.catalog.has(PDFName.of('AA'))) {
      pdfDoc.catalog.delete(PDFName.of('AA'));
      summary.javascriptActionsRemoved++;
    }
    if (pdfDoc.catalog.has(PDFName.of('JavaScript'))) {
      pdfDoc.catalog.delete(PDFName.of('JavaScript'));
      summary.javascriptActionsRemoved++;
    }

    const namesRef = pdfDoc.catalog.get(PDFName.of('Names'));
    if (namesRef) {
      const namesDict = pdfDoc.context.lookup(namesRef);
      if (namesDict instanceof PDFDict && namesDict.has(PDFName.of('JavaScript'))) {
        namesDict.delete(PDFName.of('JavaScript'));
        summary.javascriptActionsRemoved++;
      }
    }
  }

  // 5. Purge Bookmarks / Document Outlines
  if (options.removeBookmarks) {
    if (pdfDoc.catalog.has(PDFName.of('Outlines'))) {
      pdfDoc.catalog.delete(PDFName.of('Outlines'));
      summary.bookmarksRemoved = true;
    }
  }

  // 6. Purge Interactive Forms
  if (options.removeFormFields) {
    if (pdfDoc.catalog.has(PDFName.of('AcroForm'))) {
      const acroFormDict = pdfDoc.context.lookup(pdfDoc.catalog.get(PDFName.of('AcroForm')));
      if (acroFormDict instanceof PDFDict && acroFormDict.has(PDFName.of('Fields'))) {
        const fieldsArray = pdfDoc.context.lookup(acroFormDict.get(PDFName.of('Fields')));
        if (fieldsArray instanceof PDFArray) {
          summary.formFieldsRemoved += fieldsArray.size();
        }
      }
      pdfDoc.catalog.delete(PDFName.of('AcroForm'));
    }
  }

  // 7. Purge PieceInfo from Catalog
  if (options.removePieceInfo) {
    if (pdfDoc.catalog.has(PDFName.of('PieceInfo'))) {
      pdfDoc.catalog.delete(PDFName.of('PieceInfo'));
      summary.pieceInfoRemoved++;
    }
  }

  // 8. Purge Structural Tag Tree
  if (options.removeStructTree) {
    if (pdfDoc.catalog.has(PDFName.of('StructTreeRoot'))) {
      pdfDoc.catalog.delete(PDFName.of('StructTreeRoot'));
      summary.structTreeRemoved = true;
    }
    if (pdfDoc.catalog.has(PDFName.of('MarkInfo'))) {
      pdfDoc.catalog.delete(PDFName.of('MarkInfo'));
    }
  }

  // 9. Purge Page-Level Artifacts (Annotations, Links, Thumbnails, Page JS, PieceInfo)
  const pageCount = pdfDoc.getPageCount();
  for (let i = 0; i < pageCount; i++) {
    const page = pdfDoc.getPage(i);

    if (options.removePieceInfo && page.node.has(PDFName.of('PieceInfo'))) {
      page.node.delete(PDFName.of('PieceInfo'));
      summary.pieceInfoRemoved++;
    }

    if (options.removeThumbnails && page.node.has(PDFName.of('Thumb'))) {
      page.node.delete(PDFName.of('Thumb'));
      summary.thumbnailsRemoved++;
    }

    if (options.removeJavascript && page.node.has(PDFName.of('AA'))) {
      page.node.delete(PDFName.of('AA'));
      summary.javascriptActionsRemoved++;
    }

    const annotsRef = page.node.get(PDFName.of('Annots'));
    if (annotsRef) {
      const annotsArray = pdfDoc.context.lookup(annotsRef);
      if (annotsArray instanceof PDFArray) {
        const retainedRefs: (PDFRef | PDFDict)[] = [];
        for (let j = 0; j < annotsArray.size(); j++) {
          const itemRef = annotsArray.get(j);
          const annotDict = pdfDoc.context.lookup(itemRef);

          if (annotDict instanceof PDFDict) {
            const subtype = annotDict.get(PDFName.of('Subtype'));
            const subtypeStr =
              subtype instanceof PDFName ? subtype.asString() : '';

            if (subtypeStr === '/Link') {
              if (options.removeLinks) {
                summary.linksRemoved++;
              } else {
                retainedRefs.push(itemRef as PDFRef | PDFDict);
              }
            } else if (subtypeStr === '/Widget') {
              if (options.removeFormFields) {
                summary.formFieldsRemoved++;
              } else {
                retainedRefs.push(itemRef as PDFRef | PDFDict);
              }
            } else {
              if (options.removeAnnotations) {
                summary.annotationsRemoved++;
              } else {
                retainedRefs.push(itemRef as PDFRef | PDFDict);
              }
            }
          } else {
            retainedRefs.push(itemRef as PDFRef | PDFDict);
          }
        }

        if (retainedRefs.length === 0) {
          page.node.delete(PDFName.of('Annots'));
        } else if (retainedRefs.length < annotsArray.size()) {
          const newArray = pdfDoc.context.obj(retainedRefs);
          page.node.set(PDFName.of('Annots'), newArray);
        }
      }
    }
  }

  const sanitizedBytes = await pdfDoc.save({
    useObjectStreams: false,
  });
  return { sanitizedBytes, summary };
}
