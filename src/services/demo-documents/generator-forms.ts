/**
 * ISO 32000-1 Clause 12.7 Interactive Forms Compliance Document Generator.
 *
 * Constructs a multi-page PDF document containing all AcroForm field types:
 * single-line text, multi-line text, read-only text, checkboxes, radio groups,
 * dropdown combo-boxes, option list-boxes, and push buttons.
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { CanvasElement, FormFieldElement } from '../../stores/canvas-types';

export async function generateFormsPdfBuffer(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const courier = await doc.embedFont(StandardFonts.Courier);

  const pageWidth = 612;
  const pageHeight = 792;
  const form = doc.getForm();

  // Page 1: Text Inputs, Checkboxes, Radios, and Dropdowns
  const page1 = doc.addPage([pageWidth, pageHeight]);

  // Header Banner
  page1.drawRectangle({
    x: 36,
    y: 720,
    width: 540,
    height: 48,
    color: rgb(0.08, 0.18, 0.36),
  });

  page1.drawText('ISO 32000-1 Clause 12.7 Interactive Forms Compliance Suite', {
    x: 48,
    y: 746,
    size: 13,
    font: helveticaBold,
    color: rgb(1, 1, 1),
  });

  page1.drawText('Standard Interactive AcroForm Widgets: Fields, Radios, Toggles, and Dropdowns', {
    x: 48,
    y: 732,
    size: 8.5,
    font: helvetica,
    color: rgb(0.72, 0.84, 0.98),
  });

  // Section 1: Text Inputs
  page1.drawText('1. Text Entry Fields (Single-line, Multi-line, Read-only)', {
    x: 40,
    y: 694,
    size: 11,
    font: helveticaBold,
    color: rgb(0.12, 0.16, 0.24),
  });

  page1.drawLine({
    start: { x: 40, y: 688 },
    end: { x: 572, y: 688 },
    thickness: 0.75,
    color: rgb(0.8, 0.83, 0.88),
  });

  // Applicant Name (Single-line)
  page1.drawText('Full Legal Name (Single-line Text):', {
    x: 44,
    y: 668,
    size: 9,
    font: helveticaBold,
    color: rgb(0.2, 0.2, 0.2),
  });
  const nameField = form.createTextField('form.applicant_name');
  nameField.setText('Ada Lovelace');
  nameField.addToPage(page1, { x: 44, y: 642, width: 250, height: 20 });

  // Applicant Email
  page1.drawText('Email Address:', {
    x: 310,
    y: 668,
    size: 9,
    font: helveticaBold,
    color: rgb(0.2, 0.2, 0.2),
  });
  const emailField = form.createTextField('form.applicant_email');
  emailField.setText('ada@analytical-engine.org');
  emailField.addToPage(page1, { x: 310, y: 642, width: 250, height: 20 });

  // Read-only Record ID
  page1.drawText('Record Identifier (Read-only Field):', {
    x: 44,
    y: 622,
    size: 9,
    font: helveticaBold,
    color: rgb(0.2, 0.2, 0.2),
  });
  const idField = form.createTextField('form.applicant_id');
  idField.setText('ISO-32000-FORM-2026-X9');
  idField.enableReadOnly();
  idField.addToPage(page1, { x: 44, y: 596, width: 250, height: 20 });

  // Comments (Multi-line)
  page1.drawText('Detailed Compliance Statement (Multi-line Text):', {
    x: 44,
    y: 576,
    size: 9,
    font: helveticaBold,
    color: rgb(0.2, 0.2, 0.2),
  });
  const commentsField = form.createTextField('form.comments');
  commentsField.enableMultiline();
  commentsField.setText('All AcroForm field entries validate against ISO 32000-1 specifications.\nForm data parsing operates client-side with full UTF-8 encoding support.');
  commentsField.addToPage(page1, { x: 44, y: 504, width: 516, height: 64 });

  // Section 2: Options and Selections
  page1.drawText('2. Checkboxes, Radio Sets, and Selection Controls', {
    x: 40,
    y: 476,
    size: 11,
    font: helveticaBold,
    color: rgb(0.12, 0.16, 0.24),
  });

  page1.drawLine({
    start: { x: 40, y: 470 },
    end: { x: 572, y: 470 },
    thickness: 0.75,
    color: rgb(0.8, 0.83, 0.88),
  });

  // Confirmation Checkbox
  const confirmBox = form.createCheckBox('form.confirmation_checkbox');
  confirmBox.check();
  confirmBox.addToPage(page1, { x: 44, y: 440, width: 16, height: 16 });
  page1.drawText('I confirm that all interactive form elements adhere to PDF compliance requirements.', {
    x: 68,
    y: 444,
    size: 9,
    font: helvetica,
    color: rgb(0.2, 0.2, 0.2),
  });

  // Radio Group for Priority
  page1.drawText('Execution Priority (Mutually Exclusive Radio Set):', {
    x: 44,
    y: 412,
    size: 9,
    font: helveticaBold,
    color: rgb(0.2, 0.2, 0.2),
  });
  const radioGroup = form.createRadioGroup('form.priority_radio');
  radioGroup.addOptionToPage('Low', page1, { x: 44, y: 388, width: 14, height: 14 });
  page1.drawText('Low Priority', { x: 64, y: 390, size: 8.5, font: helvetica, color: rgb(0.2, 0.2, 0.2) });

  radioGroup.addOptionToPage('Normal', page1, { x: 160, y: 388, width: 14, height: 14 });
  page1.drawText('Normal Priority', { x: 180, y: 390, size: 8.5, font: helvetica, color: rgb(0.2, 0.2, 0.2) });

  radioGroup.addOptionToPage('Urgent', page1, { x: 280, y: 388, width: 14, height: 14 });
  page1.drawText('Urgent Priority', { x: 300, y: 390, size: 8.5, font: helvetica, color: rgb(0.2, 0.2, 0.2) });
  radioGroup.select('Urgent');

  // Department Dropdown
  page1.drawText('Target Department (Dropdown Combo-Box):', {
    x: 44,
    y: 358,
    size: 9,
    font: helveticaBold,
    color: rgb(0.2, 0.2, 0.2),
  });
  const deptDropdown = form.createDropdown('form.department_dropdown');
  deptDropdown.addOptions([
    'Core Systems Engineering',
    'Document Security & Compliance',
    'Typographic Design',
    'Platform Quality Assurance',
  ]);
  deptDropdown.select('Document Security & Compliance');
  deptDropdown.addToPage(page1, { x: 44, y: 330, width: 280, height: 22 });

  // Option List Box
  page1.drawText('Assigned Roles (Multi-Option List Box):', {
    x: 44,
    y: 298,
    size: 9,
    font: helveticaBold,
    color: rgb(0.2, 0.2, 0.2),
  });
  const rolesList = form.createOptionList('form.roles_listbox');
  rolesList.addOptions([
    'Systems Auditor',
    'Lead WebAssembly Architect',
    'Security Officer',
    'Standards Delegate',
  ]);
  rolesList.select('Lead WebAssembly Architect');
  rolesList.addToPage(page1, { x: 44, y: 220, width: 280, height: 68 });

  // Page 1 Footer
  page1.drawText('Page 1 of 2 - AcroForm Inputs & Toggles', {
    x: 390,
    y: 40,
    size: 8,
    font: helvetica,
    color: rgb(0.5, 0.5, 0.5),
  });

  // Page 2: Push Buttons and Interactive Action Elements
  const page2 = doc.addPage([pageWidth, pageHeight]);

  page2.drawRectangle({
    x: 36,
    y: 720,
    width: 540,
    height: 48,
    color: rgb(0.08, 0.18, 0.36),
  });

  page2.drawText('ISO 32000-1 Interactive Action Triggers & Push Buttons', {
    x: 48,
    y: 746,
    size: 13,
    font: helveticaBold,
    color: rgb(1, 1, 1),
  });

  page2.drawText('Form Actions: Submit, Reset, and Placeholder Signatures', {
    x: 48,
    y: 732,
    size: 8.5,
    font: helvetica,
    color: rgb(0.72, 0.84, 0.98),
  });

  // Section: Push Buttons
  page2.drawText('3. Action Push Buttons', {
    x: 40,
    y: 694,
    size: 11,
    font: helveticaBold,
    color: rgb(0.12, 0.16, 0.24),
  });

  page2.drawLine({
    start: { x: 40, y: 688 },
    end: { x: 572, y: 688 },
    thickness: 0.75,
    color: rgb(0.8, 0.83, 0.88),
  });

  const submitButton = form.createButton('form.submit_button');
  submitButton.addToPage('Submit Verification Payload', page2, {
    x: 44,
    y: 646,
    width: 200,
    height: 28,
  });

  const resetButton = form.createButton('form.reset_button');
  resetButton.addToPage('Reset Defaults', page2, {
    x: 260,
    y: 646,
    width: 140,
    height: 28,
  });

  // Signature Zone Representation
  page2.drawText('4. Signature Widget Placement Area', {
    x: 40,
    y: 600,
    size: 11,
    font: helveticaBold,
    color: rgb(0.12, 0.16, 0.24),
  });

  page2.drawLine({
    start: { x: 40, y: 594 },
    end: { x: 572, y: 594 },
    thickness: 0.75,
    color: rgb(0.8, 0.83, 0.88),
  });

  page2.drawRectangle({
    x: 44,
    y: 470,
    width: 320,
    height: 100,
    color: rgb(0.98, 0.98, 1),
    borderColor: rgb(0.3, 0.5, 0.8),
    borderWidth: 1,
  });

  page2.drawText('Authorized Form Signer Placeholder', {
    x: 56,
    y: 546,
    size: 10,
    font: helveticaBold,
    color: rgb(0.2, 0.3, 0.5),
  });

  page2.drawText('Verified by ISO 32000 Conformance Engine', {
    x: 56,
    y: 530,
    size: 8.5,
    font: courier,
    color: rgb(0.4, 0.4, 0.4),
  });

  page2.drawText('Page 2 of 2 - AcroForm Action Buttons', {
    x: 390,
    y: 40,
    size: 8,
    font: helvetica,
    color: rgb(0.5, 0.5, 0.5),
  });

  return await doc.save();
}

export function getFormsCanvasElements(): CanvasElement[] {
  const formElement1: FormFieldElement = {
    id: 'compliance-canvas-form-1',
    kind: 'form-field',
    pageIndex: 0,
    x: 340,
    y: 330,
    width: 220,
    height: 28,
    rotation: 0,
    locked: false,
    visible: true,
    flipX: false,
    flipY: false,
    variant: 'text-input',
    label: 'Interactive Overlay Field',
    placeholder: 'Test live inline canvas editing...',
  };

  const formElement2: FormFieldElement = {
    id: 'compliance-canvas-form-2',
    kind: 'form-field',
    pageIndex: 1,
    x: 44,
    y: 360,
    width: 280,
    height: 32,
    rotation: 0,
    locked: false,
    visible: true,
    flipX: false,
    flipY: false,
    variant: 'text-input',
    label: 'Signer Title Verification',
    placeholder: 'Enter certification title...',
  };

  return [formElement1, formElement2];
}
