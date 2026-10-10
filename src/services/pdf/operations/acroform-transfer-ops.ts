import { PDFDocument, PDFName, PDFDict, PDFRef, PDFString, PDFHexString, type PDFPage } from 'pdf-lib';

/**
 * Traverses upwards through /Parent references to locate the root AcroForm field object.
 *
 * @param dict The current dictionary node.
 * @param annotRef The reference of the widget annotation.
 * @param context The target document context.
 * @returns An object containing the root field reference and the root dictionary.
 */
function findRootField(
  dict: PDFDict,
  annotRef: PDFRef,
  context: PDFDocument['context']
): { rootRef: PDFRef; rootDict: PDFDict } {
  let rootRef = annotRef;
  let rootDict = dict;

  while (rootDict.has(PDFName.of('Parent'))) {
    const parent = rootDict.get(PDFName.of('Parent'));
    if (parent instanceof PDFRef) {
      rootRef = parent;
      const lookupResult = context.lookup(parent);
      if (lookupResult instanceof PDFDict) {
        rootDict = lookupResult;
      } else {
        break;
      }
    } else {
      break;
    }
  }

  return { rootRef, rootDict };
}

/**
 * Inspects copied pages and links their widget annotations to the target document's AcroForm dictionary,
 * disambiguating duplicate field names and ensuring field values and interactive appearances are preserved.
 *
 * @param targetDoc The destination PDFDocument.
 * @param copiedPages The array of pages copied into the destination document.
 * @param filePrefix Optional prefix to resolve name collisions across merged files.
 * @param existingNames Optional set of field names already registered in the destination document.
 */
export function linkCopiedPageAcroForms(
  targetDoc: PDFDocument,
  copiedPages: PDFPage[],
  filePrefix: string = 'merged',
  existingNames?: Set<string>
): void {
  const targetForm = targetDoc.getForm();
  const existingFieldRefs = new Set<PDFRef>(
    targetForm.acroForm.getFields().map(([, ref]) => ref)
  );
  const registeredNames = existingNames ?? new Set<string>();

  // Seed registered names from existing fields if not already populated
  if (registeredNames.size === 0) {
    for (const f of targetForm.getFields()) {
      registeredNames.add(f.getName());
    }
  }

  let hasFormFields = false;

  for (const page of copiedPages) {
    const annots = page.node.Annots();
    if (!annots) continue;

    for (let i = 0; i < annots.size(); i++) {
      const annotRef = annots.get(i);
      const annotDict = annots.lookup(i);
      if (!(annotDict instanceof PDFDict) || !(annotRef instanceof PDFRef)) {
        continue;
      }

      const subtype = annotDict.lookup(PDFName.of('Subtype'));
      if (subtype?.toString() !== '/Widget') {
        continue;
      }

      hasFormFields = true;
      const { rootRef, rootDict } = findRootField(annotDict, annotRef, targetDoc.context);

      if (!existingFieldRefs.has(rootRef)) {
        existingFieldRefs.add(rootRef);

        const tEntry = rootDict.lookup(PDFName.of('T'));
        let fieldName = '';
        if (tEntry instanceof PDFString || tEntry instanceof PDFHexString) {
          fieldName = tEntry.decodeText();
        }

        if (fieldName && registeredNames.has(fieldName)) {
          let uniqueName = `${fieldName}_${filePrefix}`;
          let disambiguationCounter = 1;
          while (registeredNames.has(uniqueName)) {
            disambiguationCounter++;
            uniqueName = `${fieldName}_${filePrefix}_${disambiguationCounter}`;
          }
          rootDict.set(PDFName.of('T'), PDFHexString.fromText(uniqueName));
          registeredNames.add(uniqueName);
        } else if (fieldName) {
          registeredNames.add(fieldName);
        }

        targetForm.acroForm.addField(rootRef);
      }
    }
  }

  if (hasFormFields) {
    targetForm.acroForm.dict.set(PDFName.of('NeedAppearances'), targetDoc.context.obj(true));
  }
}

/**
 * Splits specific pages from a source PDF buffer into a new standalone document whilst preserving
 * all AcroForm dictionaries, interactive widgets, field values, and hierarchy.
 *
 * @param srcBuffer Binary buffer of the source PDF.
 * @param pageIndices Zero-based page indices to extract.
 * @returns Binary Uint8Array of the extracted PDF.
 */
export async function splitPdfBufferWithAcroForms(
  srcBuffer: ArrayBuffer | Uint8Array,
  pageIndices: number[]
): Promise<Uint8Array> {
  const bytes = srcBuffer instanceof Uint8Array ? srcBuffer : new Uint8Array(srcBuffer);
  const srcDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const targetDoc = await PDFDocument.create();

  const validIndices = pageIndices.filter(
    (idx) => idx >= 0 && idx < srcDoc.getPageCount()
  );
  if (validIndices.length === 0) {
    throw new Error('No valid page indices provided for extraction.');
  }

  const copiedPages = await targetDoc.copyPages(srcDoc, validIndices);
  for (const page of copiedPages) {
    targetDoc.addPage(page);
  }

  linkCopiedPageAcroForms(targetDoc, copiedPages, 'extracted');

  return targetDoc.save({ updateFieldAppearances: false });
}

/**
 * Merges an incoming PDF buffer into a base PDF buffer at a specific page index, preserving all
 * interactive AcroForms from both documents without dangling pointers or memory collisions.
 *
 * @param baseBuffer Binary buffer of the base PDF.
 * @param incomingBuffer Binary buffer of the incoming PDF to merge.
 * @param insertAtIndex Zero-based index at which to insert incoming pages.
 * @returns Binary Uint8Array of the merged document.
 */
export async function mergePdfBuffersWithAcroForms(
  baseBuffer: ArrayBuffer | Uint8Array,
  incomingBuffer: ArrayBuffer | Uint8Array,
  insertAtIndex: number
): Promise<Uint8Array> {
  const baseBytes = baseBuffer instanceof Uint8Array ? baseBuffer : new Uint8Array(baseBuffer);
  const incomingBytes = incomingBuffer instanceof Uint8Array ? incomingBuffer : new Uint8Array(incomingBuffer);

  const baseDoc = await PDFDocument.load(baseBytes, { ignoreEncryption: true });
  const incomingDoc = await PDFDocument.load(incomingBytes, { ignoreEncryption: true });

  const targetDoc = await PDFDocument.create();
  const registeredNames = new Set<string>();

  const baseCount = baseDoc.getPageCount();
  const clampedIndex = Math.max(0, Math.min(insertAtIndex, baseCount));

  // Copy preceding base pages
  if (clampedIndex > 0) {
    const preIndices = Array.from({ length: clampedIndex }, (_, i) => i);
    const prePages = await targetDoc.copyPages(baseDoc, preIndices);
    for (const page of prePages) {
      targetDoc.addPage(page);
    }
    linkCopiedPageAcroForms(targetDoc, prePages, 'base', registeredNames);
  }

  // Copy incoming pages
  const incomingIndices = incomingDoc.getPageIndices();
  if (incomingIndices.length > 0) {
    const incPages = await targetDoc.copyPages(incomingDoc, incomingIndices);
    for (const page of incPages) {
      targetDoc.addPage(page);
    }
    linkCopiedPageAcroForms(targetDoc, incPages, 'merged', registeredNames);
  }

  // Copy subsequent base pages
  if (clampedIndex < baseCount) {
    const postIndices = Array.from(
      { length: baseCount - clampedIndex },
      (_, i) => clampedIndex + i
    );
    const postPages = await targetDoc.copyPages(baseDoc, postIndices);
    for (const page of postPages) {
      targetDoc.addPage(page);
    }
    linkCopiedPageAcroForms(targetDoc, postPages, 'base', registeredNames);
  }

  return targetDoc.save({ updateFieldAppearances: false });
}
