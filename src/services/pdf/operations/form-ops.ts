import { PDFDocument, PDFName, PDFNumber, PDFBool, PDFDict, PDFArray } from 'pdf-lib';

/**
 * Result metrics returned by form unlocking operations.
 */
export interface UnlockFormsResult {
  /** Serialised document bytes with interactive form restrictions removed. */
  unlockedBytes: Uint8Array;
  /** Number of AcroForm terminal and non-terminal fields unlocked. */
  fieldsUnlockedCount: number;
  /** Number of page widget annotations unlocked. */
  annotationsUnlockedCount: number;
}

/**
 * Traverses AcroForm fields and widget annotations to clear read-only and locked flags.
 * Conforms to ISO 32000-1 Clause 12.7 (Interactive Forms) and ensures dynamic viewer appearance regeneration.
 */
export async function unlockAcroFormFields(pdfBytes: Uint8Array): Promise<UnlockFormsResult> {
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  let fieldsUnlockedCount = 0;
  let annotationsUnlockedCount = 0;

  // Process high-level AcroForm field definitions
  let form;
  try {
    form = pdfDoc.getForm();
  } catch {
    form = null;
  }

  if (form) {
    const fields = form.getFields();
    for (const field of fields) {
      let changed = false;
      if (field.isReadOnly()) {
        field.disableReadOnly();
        changed = true;
      }
      if (field.isRequired()) {
        field.disableRequired();
        changed = true;
      }
      if (changed) {
        fieldsUnlockedCount++;
      }
    }
  }

  // Ensure root AcroForm dictionary has NeedAppearances set to true
  const catalog = pdfDoc.catalog;
  const acroForm = catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  if (acroForm) {
    acroForm.set(PDFName.of('NeedAppearances'), PDFBool.True);

    // Recursively traverse raw field trees to clear any lingering bit flags on /Ff
    const fieldsArray = acroForm.lookupMaybe(PDFName.of('Fields'), PDFArray);
    if (fieldsArray) {
      const traverseFieldDict = (dict: PDFDict) => {
        const ff = dict.lookupMaybe(PDFName.of('Ff'), PDFNumber);
        if (ff) {
          let flags = ff.asNumber();
          const orig = flags;
          // Clear Bit 1 (ReadOnly = 1) and Bit 2 (Required = 2)
          flags &= ~1;
          flags &= ~2;
          if (flags !== orig) {
            dict.set(PDFName.of('Ff'), PDFNumber.of(flags));
          }
        }
        const kids = dict.lookupMaybe(PDFName.of('Kids'), PDFArray);
        if (kids) {
          for (let i = 0; i < kids.size(); i++) {
            const kid = kids.lookupMaybe(i, PDFDict);
            if (kid) {
              traverseFieldDict(kid);
            }
          }
        }
      };

      for (let i = 0; i < fieldsArray.size(); i++) {
        const fieldDict = fieldsArray.lookupMaybe(i, PDFDict);
        if (fieldDict) {
          traverseFieldDict(fieldDict);
        }
      }
    }
  }

  // Inspect page annotation arrays to clear widget Locked and Invisible flags
  const pages = pdfDoc.getPages();
  for (const page of pages) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) continue;

    for (let i = 0; i < annots.size(); i++) {
      const annot = annots.lookupMaybe(i, PDFDict);
      if (!annot) continue;

      const subtype = annot.lookupMaybe(PDFName.of('Subtype'), PDFName);
      const isWidget = subtype?.asString() === '/Widget';

      const f = annot.lookupMaybe(PDFName.of('F'), PDFNumber);
      if (f) {
        let flags = f.asNumber();
        const orig = flags;
        // Bit 1: Invisible (1), Bit 7: Locked (64), Bit 8: NoRotate (128 - keep), Bit 9: NoZoom (256 - keep)
        // For widget annotations, also clear Bit 3: Hidden (4) if set
        if (isWidget) {
          flags &= ~1; // Invisible
          flags &= ~4; // Hidden
          flags &= ~64; // Locked
        } else {
          flags &= ~64; // Locked
        }

        if (flags !== orig) {
          annot.set(PDFName.of('F'), PDFNumber.of(flags));
          annotationsUnlockedCount++;
        }
      }
    }
  }

  const unlockedBytes = await pdfDoc.save({ useObjectStreams: false });

  return {
    unlockedBytes,
    fieldsUnlockedCount,
    annotationsUnlockedCount,
  };
}
