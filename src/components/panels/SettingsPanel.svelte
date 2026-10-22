<script lang="ts">
  import { untrack } from 'svelte';
  import type { DocumentMetadata, DocumentMetadataUpdate } from '../../core/types';
  import type { SignatureValidationResult } from '../../services/pdf/operations/signature-ops';
  import { useEditorStore, getFileBuffer } from '../../stores/editor.svelte';
  import { useEditorActions } from '../../stores/editor-actions';
  import { useFeatureFlagStore } from '../../core/feature-flags';
  import { formatByteSize } from '../../services/pdf/operations/metadata-ops';
  import { getSavedSignatures, getSavedDigitalSignatures } from '../../services/signature-storage';
  import SidebarSection from '../common/SidebarSection.svelte';
  import SecurityComplianceSection from '../dialogs/SecurityComplianceSection.svelte';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import {
    Lock,
    ShieldCheck,
    FileKey,
    Info,
    Wrench,
    Code2,
    Unlock,
    ListTree,
    ChevronDown,
    ChevronRight,
    AlertCircle,
    Check,
    Loader2,
    Palette,
    Eye,
    Copy,
    Plus,
    PenTool,
    CheckCircle2,
    Clock,
    Users,
  } from 'lucide-svelte';

  const store = useEditorStore();
  const actions = useEditorActions();
  const featureFlags = useFeatureFlagStore();

  type EditableStandardField = 'title' | 'author' | 'subject' | 'creator' | 'producer' | 'keywords';

  const STANDARD_METADATA_KEYS: readonly EditableStandardField[] = [
    'title',
    'author',
    'subject',
    'creator',
    'producer',
    'keywords',
  ];

  const STANDARD_METADATA_KEY_SET = new Set<string>([
    ...STANDARD_METADATA_KEYS,
    'creationdate',
    'moddate',
    'trapped',
  ]);

  let metadata = $state<DocumentMetadata | null>(null);
  let signatureResults = $state<SignatureValidationResult[]>([]);
  let isValidatingSignatures = $state(false);
  let savedCount = $state(0);
  let savedCertCount = $state(0);
  let userPassword = $state('');
  let ownerPassword = $state('');
  let showAllFields = $state(false);

  let editingKey = $state<string | null>(null);
  let editingInitialValue = '';
  let editingInitialKey = '';

  let selectedMetadataKeys = $state<string[]>([]);
  let lastSelectedMetadataKey = $state<string | null>(null);
  let isActivelyTypingInKey = $state(false);

  let isApplyingSecurity = $state(false);
  let isRemovingSecurity = $state(false);
  let isUnlockingForms = $state(false);
  let isRawDictCopied = $state(false);
  let securityMessage = $state<string | null>(null);
  let securityError = $state<string | null>(null);

  const isDocumentEncrypted = $derived(metadata?.isEncrypted ?? false);

  const documentSizeBytes = $derived.by(() => {
    if (!store.isDocumentLoaded) return undefined;
    if (metadata?.sizeBytes && metadata.sizeBytes > 0) {
      return metadata.sizeBytes;
    }
    const buffer = store.activeWorkspaceFileId
      ? getFileBuffer(store.activeWorkspaceFileId)
      : undefined;
    if (buffer && buffer.byteLength > 0) {
      return buffer.byteLength;
    }
    const file = store.workspaceFiles.find(
      (f) => f.id === store.activeWorkspaceFileId
    );
    return file?.sizeBytes;
  });

  const formattedDocumentSize = $derived.by(() => {
    if (!store.isDocumentLoaded) return '-';
    if (documentSizeBytes !== undefined) {
      return formatByteSize(documentSizeBytes);
    }
    if (metadata?.sizeFormatted && metadata.sizeFormatted !== '-') {
      return metadata.sizeFormatted;
    }
    return '-';
  });

  interface CustomFieldItem {
    id: string;
    key: string;
    value: string;
    persistedKey?: string;
    persistedValue?: string;
  }

  let customFieldEntries = $state<CustomFieldItem[]>([]);
  let nextCustomRowId = 1;
  let hasInitialisedCustomFields = false;

  function buildInitialCustomFields(meta: DocumentMetadata | null): CustomFieldItem[] {
    if (!meta) return [];
    const map = new Map<string, string>();
    if (meta.customMetadata) {
      for (const [k, v] of Object.entries(meta.customMetadata)) {
        map.set(k, v || '');
      }
    }
    if (meta.allEntries) {
      for (const entry of meta.allEntries) {
        if (!entry.isStandard && !map.has(entry.key)) {
          map.set(entry.key, entry.value || '');
        }
      }
    }
    const sortedKeys = Array.from(map.keys()).sort((a, b) => a.localeCompare(b));
    return sortedKeys.map((key) => {
      const value = map.get(key) ?? '';
      return {
        id: `custom-row-${nextCustomRowId++}`,
        key,
        value,
        persistedKey: key,
        persistedValue: value,
      };
    });
  }

  function reconcileCustomFieldsFromMetadata(meta: DocumentMetadata | null): void {
    if (!meta) {
      customFieldEntries = [];
      hasInitialisedCustomFields = false;
      return;
    }
    if (!hasInitialisedCustomFields) {
      customFieldEntries = buildInitialCustomFields(meta);
      hasInitialisedCustomFields = true;
      return;
    }

    const incoming = new Map<string, string>();
    if (meta.customMetadata) {
      for (const [k, v] of Object.entries(meta.customMetadata)) {
        incoming.set(k, v || '');
      }
    }
    if (meta.allEntries) {
      for (const entry of meta.allEntries) {
        if (!entry.isStandard && !incoming.has(entry.key)) {
          incoming.set(entry.key, entry.value || '');
        }
      }
    }

    const updated: CustomFieldItem[] = [];
    const seen = new Set<string>();
    for (const existing of customFieldEntries) {
      if (incoming.has(existing.key)) {
        const val = incoming.get(existing.key) ?? '';
        updated.push({
          ...existing,
          value: val,
          persistedKey: existing.key,
          persistedValue: val,
        });
        seen.add(existing.key);
      } else if (existing.persistedKey === undefined) {
        updated.push(existing);
        seen.add(existing.key);
      }
    }
    for (const [k, val] of incoming.entries()) {
      if (!seen.has(k)) {
        updated.push({
          id: `custom-row-${nextCustomRowId++}`,
          key: k,
          value: val,
          persistedKey: k,
          persistedValue: val,
        });
      }
    }
    customFieldEntries = updated;
  }

  function syncMetadataCustomRecord(): Record<string, string> {
    const record: Record<string, string> = {};
    for (const entry of customFieldEntries) {
      if (entry.key) {
        record[entry.key] = entry.value;
      }
    }
    if (metadata) {
      metadata.customMetadata = record;
      const standardEntries = (metadata.allEntries || []).filter((e) => e.isStandard);
      const customEntries = customFieldEntries.map((entry) => ({
        key: entry.key,
        rawKey: `/${entry.key}`,
        value: entry.value,
        isStandard: false,
      }));
      metadata.allEntries = [...standardEntries, ...customEntries];
    }
    return record;
  }

  const totalMetadataCount = $derived.by<number>(() => {
    return 6 + customFieldEntries.length;
  });

  const visibleCustomEntries = $derived.by<CustomFieldItem[]>(() => {
    if (totalMetadataCount <= 8 || showAllFields) {
      return customFieldEntries;
    }
    const customLimit = Math.max(0, 8 - 6);
    return customFieldEntries.slice(0, customLimit);
  });

  const selectableMetadataKeys = $derived.by<string[]>(() => {
    return visibleCustomEntries.map((entry) => entry.key);
  });

  let lastLoadedKey = '';
  let lastLoadedFileId: string | null = null;
  let isFetchingMetadata = false;
  let pendingMetadataRefresh = false;
  let pendingSignatureLoad = false;
  let isComponentMounted = true;
  let metadataUpdateChain: Promise<void> = Promise.resolve();

  $effect(() => {
    isComponentMounted = true;
    return () => {
      isComponentMounted = false;
    };
  });

  $effect(() => {
    // note: re-evaluate signature count when e-sign or cert-sign dialog opens or closes
    void store.showEsignDialog;
    void store.showCertSignDialog;
    savedCount = getSavedSignatures().length;
    savedCertCount = getSavedDigitalSignatures().length;
  });

  $effect(() => {
    const isLoaded = store.isDocumentLoaded;
    const fileId = store.activeWorkspaceFileId;
    const version = store.renderVersion;

    untrack(() => {
      if (!isLoaded) {
        lastLoadedKey = '';
        lastLoadedFileId = null;
        metadata = null;
        signatureResults = [];
        customFieldEntries = [];
        hasInitialisedCustomFields = false;
        selectedMetadataKeys = [];
        lastSelectedMetadataKey = null;
        isActivelyTypingInKey = false;
        return;
      }

      if (fileId !== lastLoadedFileId) {
        lastLoadedFileId = fileId;
        customFieldEntries = [];
        hasInitialisedCustomFields = false;
        selectedMetadataKeys = [];
        lastSelectedMetadataKey = null;
        isActivelyTypingInKey = false;
      }

      const currentKey = `${fileId}:${version}`;
      if (currentKey === lastLoadedKey) {
        return;
      }
      lastLoadedKey = currentKey;

      void refreshMetadataAndSignatures();
    });
  });

  async function refreshMetadataAndSignatures(): Promise<void> {
    if (!store.isDocumentLoaded || !isComponentMounted) return;
    if (isFetchingMetadata) {
      pendingMetadataRefresh = true;
      return;
    }
    isFetchingMetadata = true;

    try {
      if (!metadata) {
        try {
          metadata = actions.service.document.getMetadata();
        } catch {
          metadata = null;
        }
      }

      try {
        const extended = await actions.getExtendedDocumentMetadata();
        if (isComponentMounted) {
          metadata = extended;
          reconcileCustomFieldsFromMetadata(extended);
        }
      } catch {
        if (isComponentMounted && metadata && !hasInitialisedCustomFields) {
          reconcileCustomFieldsFromMetadata(metadata);
        }
      }

      if (isComponentMounted) {
        await loadSignatures();
      }
    } finally {
      isFetchingMetadata = false;
      if (pendingMetadataRefresh && isComponentMounted && store.isDocumentLoaded) {
        pendingMetadataRefresh = false;
        void refreshMetadataAndSignatures();
      }
    }
  }

  async function loadSignatures(): Promise<void> {
    if (!store.isDocumentLoaded || !isComponentMounted) return;
    if (isValidatingSignatures) {
      pendingSignatureLoad = true;
      return;
    }

    isValidatingSignatures = true;
    try {
      const results = await actions.validateActiveDocumentSignatures();
      if (isComponentMounted) {
        signatureResults = results;
      }
    } catch {
      if (isComponentMounted) {
        signatureResults = [];
      }
    } finally {
      if (isComponentMounted) {
        isValidatingSignatures = false;
        if (pendingSignatureLoad && store.isDocumentLoaded) {
          pendingSignatureLoad = false;
          void loadSignatures();
        }
      }
    }
  }

  async function handleApplySecurity(): Promise<void> {
    if (!userPassword && !ownerPassword) return;
    isApplyingSecurity = true;
    securityMessage = null;
    securityError = null;
    try {
      await actions.applyPasswordSecurity(userPassword, ownerPassword);
      userPassword = '';
      ownerPassword = '';
      securityMessage = 'Password protection successfully applied.';
      metadata = actions.service.document.getMetadata();
    } catch (err) {
      securityError = err instanceof Error ? err.message : 'Failed to apply password security.';
    } finally {
      isApplyingSecurity = false;
    }
  }

  async function handleRemoveSecurity(): Promise<void> {
    isRemovingSecurity = true;
    securityMessage = null;
    securityError = null;
    try {
      await actions.removePasswordSecurity(ownerPassword || undefined);
      ownerPassword = '';
      securityMessage = 'Document security removed successfully.';
      metadata = actions.service.document.getMetadata();
    } catch (err) {
      securityError = err instanceof Error ? err.message : 'Failed to remove security.';
    } finally {
      isRemovingSecurity = false;
    }
  }

  async function handleUnlockForms(): Promise<void> {
    isUnlockingForms = true;
    securityMessage = null;
    securityError = null;
    try {
      const res = await actions.unlockForms();
      if (res.fieldsUnlockedCount > 0 || res.annotationsUnlockedCount > 0) {
        securityMessage = `Unlocked ${res.fieldsUnlockedCount} form fields (${res.annotationsUnlockedCount} widgets).`;
      } else {
        securityMessage = 'All form fields are already editable.';
      }
    } catch (err) {
      securityError = err instanceof Error ? err.message : 'Failed to unlock form fields.';
    } finally {
      isUnlockingForms = false;
    }
  }

  async function enqueueMetadataUpdate(updates: DocumentMetadataUpdate): Promise<void> {
    const runUpdate = async (): Promise<void> => {
      try {
        await actions.updateDocumentMetadata(updates);
        lastLoadedKey = `${store.activeWorkspaceFileId}:${store.renderVersion}`;
      } catch (err) {
        console.error('Failed to update document metadata:', err);
      }
    };
    const nextPromise = metadataUpdateChain.then(runUpdate, runUpdate);
    metadataUpdateChain = nextPromise;
    return nextPromise;
  }

  function sanitizeCustomMetadataKey(raw: string): string {
    return raw.replace(/^\//, '').replace(/[\r\n\t]+/g, ' ').trim();
  }

  function generateNextCustomMetadataKey(): string {
    const existingLower = new Set<string>(STANDARD_METADATA_KEY_SET);
    for (const item of customFieldEntries) {
      existingLower.add(item.key.toLowerCase());
    }
    let index = 1;
    while (existingLower.has(`customtag${index}`)) {
      index += 1;
    }
    return `CustomTag${index}`;
  }

  function selectElementContents(el: HTMLElement): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function handleAddMetadataTag(): void {
    if (!featureFlags.isEnabled('settings.metadata.add')) return;
    if (!metadata || store.isReadOnly) return;

    const nextKey = generateNextCustomMetadataKey();
    const rowId = `custom-row-${nextCustomRowId++}`;
    customFieldEntries = [
      ...customFieldEntries,
      {
        id: rowId,
        key: nextKey,
        value: '',
        persistedKey: undefined,
        persistedValue: undefined,
      },
    ];
    showAllFields = true;
    selectedMetadataKeys = [nextKey];
    lastSelectedMetadataKey = nextKey;
    isActivelyTypingInKey = false;

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        if (!isComponentMounted || typeof document === 'undefined') return;
        const keyEl = document.querySelector<HTMLElement>(
          `[data-metadata-custom-key="${CSS.escape(nextKey)}"]`
        );
        if (keyEl) {
          keyEl.focus();
          selectElementContents(keyEl);
          isActivelyTypingInKey = false;
        }
      });
    }
  }

  function getStandardFieldValue(field: EditableStandardField): string {
    if (!metadata) return '';
    return metadata[field] || '';
  }

  function handleFocus(field: EditableStandardField, event: FocusEvent): void {
    if (store.isReadOnly) {
      (event.currentTarget as HTMLElement).blur();
      return;
    }
    const el = event.currentTarget as HTMLElement;
    editingKey = field;
    editingInitialValue = getStandardFieldValue(field);
    isActivelyTypingInKey = false;
    if (el.textContent?.trim() === '-') {
      el.textContent = '';
    }
  }

  async function handleBlur(field: EditableStandardField, event: FocusEvent): Promise<void> {
    const el = event.currentTarget as HTMLElement;
    const value = el.textContent?.trim() ?? '';
    const initial = editingInitialValue;
    editingKey = null;

    if (!value) {
      el.textContent = '-';
    }

    if (value !== initial) {
      await saveStandardField(field, value);
    }
  }

  async function saveStandardField(field: EditableStandardField, value: string): Promise<void> {
    if (!metadata || store.isReadOnly) return;
    const updates: DocumentMetadataUpdate = {
      [field]: value,
    };
    metadata[field] = value;
    if (field === 'keywords') {
      metadata.keywordsArray = value
        ? value
            .split(/[,;]+/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
    }

    await enqueueMetadataUpdate(updates);
  }

  function handleCustomKeyFocus(key: string, event: FocusEvent): void {
    if (store.isReadOnly) {
      (event.currentTarget as HTMLElement).blur();
      return;
    }
    editingKey = `custom-key:${key}`;
    editingInitialKey = key;
    if (!selectedMetadataKeys.includes(key)) {
      selectedMetadataKeys = [key];
      lastSelectedMetadataKey = key;
    }
  }

  async function handleCustomKeyBlur(key: string, event: FocusEvent): Promise<void> {
    const el = event.currentTarget as HTMLElement;
    const rawKey = el.textContent?.trim() ?? '';
    const sanitizedKey = sanitizeCustomMetadataKey(rawKey);
    const initialKey = editingInitialKey || key;
    editingKey = null;
    isActivelyTypingInKey = false;

    if (!sanitizedKey) {
      el.textContent = initialKey;
      return;
    }

    if (
      sanitizedKey !== initialKey &&
      (STANDARD_METADATA_KEY_SET.has(sanitizedKey.toLowerCase()) ||
        customFieldEntries.some((entry) => entry.key === sanitizedKey))
    ) {
      el.textContent = initialKey;
      return;
    }

    el.textContent = sanitizedKey;

    const row = customFieldEntries.find((entry) => entry.key === initialKey);
    const isUnpersistedRow = row && row.persistedKey === undefined;

    if (sanitizedKey !== initialKey || isUnpersistedRow) {
      await saveCustomKey(
        initialKey,
        sanitizedKey,
        event.relatedTarget as HTMLElement | null
      );
    }
  }

  async function saveCustomKey(
    oldKey: string,
    newKey: string,
    relatedTarget: HTMLElement | null = null
  ): Promise<void> {
    if (!metadata || store.isReadOnly) return;

    const idx = customFieldEntries.findIndex((entry) => entry.key === oldKey);
    if (idx === -1) return;

    const targetRow = customFieldEntries[idx];
    const oldPersistedKey = targetRow.persistedKey;

    customFieldEntries[idx] = {
      ...targetRow,
      key: newKey,
    };

    if (editingKey === `custom:${oldKey}`) {
      editingKey = `custom:${newKey}`;
    }

    if (selectedMetadataKeys.includes(oldKey)) {
      selectedMetadataKeys = selectedMetadataKeys.map((k) => (k === oldKey ? newKey : k));
    }
    if (lastSelectedMetadataKey === oldKey) {
      lastSelectedMetadataKey = newKey;
    }

    const isMovingToSameRowValue =
      relatedTarget?.getAttribute('data-metadata-row-id') === targetRow.id;
    if (isMovingToSameRowValue) {
      return;
    }

    const nextCustom = syncMetadataCustomRecord();
    const removeKeys =
      oldPersistedKey && oldPersistedKey !== newKey ? [oldPersistedKey] : undefined;

    customFieldEntries[idx] = {
      ...customFieldEntries[idx],
      persistedKey: newKey,
      persistedValue: customFieldEntries[idx].value,
    };

    await enqueueMetadataUpdate({
      customMetadata: nextCustom,
      removeKeys,
    });
  }

  function handleCustomFocus(key: string, event: FocusEvent): void {
    if (store.isReadOnly) {
      (event.currentTarget as HTMLElement).blur();
      return;
    }
    const el = event.currentTarget as HTMLElement;
    editingKey = `custom:${key}`;
    editingInitialValue =
      customFieldEntries.find((d) => d.key === key)?.value ??
      metadata?.customMetadata?.[key] ??
      '';
    isActivelyTypingInKey = false;
    if (el.textContent?.trim() === '-') {
      el.textContent = '';
    }
  }

  async function handleCustomBlur(key: string, event: FocusEvent): Promise<void> {
    const el = event.currentTarget as HTMLElement;
    const value = el.textContent?.trim() ?? '';
    const initial = editingInitialValue;
    editingKey = null;

    if (!value) {
      el.textContent = '-';
    }

    const row = customFieldEntries.find((entry) => entry.key === key);
    const hasUnpersistedChange =
      row !== undefined && (row.persistedKey !== row.key || row.persistedValue !== value);

    if (value !== initial || hasUnpersistedChange) {
      await saveCustomField(key, value);
    }
  }

  async function saveCustomField(key: string, value: string): Promise<void> {
    if (!metadata || store.isReadOnly) return;

    const idx = customFieldEntries.findIndex((entry) => entry.key === key);
    let oldPersistedKey: string | undefined;
    if (idx !== -1) {
      oldPersistedKey = customFieldEntries[idx].persistedKey;
      customFieldEntries[idx] = {
        ...customFieldEntries[idx],
        value,
        persistedKey: key,
        persistedValue: value,
      };
    }

    const customMetadata = syncMetadataCustomRecord();
    const removeKeys =
      oldPersistedKey && oldPersistedKey !== key ? [oldPersistedKey] : undefined;

    await enqueueMetadataUpdate({
      customMetadata,
      removeKeys,
    });
  }

  function handleMetadataKeyClick(key: string, event: MouseEvent): void {
    if (store.isReadOnly) return;
    isActivelyTypingInKey = false;
    const isMulti = event.ctrlKey || event.metaKey;
    const isRange = event.shiftKey;

    if (isRange && lastSelectedMetadataKey) {
      const keys = selectableMetadataKeys;
      const startIdx = keys.indexOf(lastSelectedMetadataKey);
      const endIdx = keys.indexOf(key);
      if (startIdx !== -1 && endIdx !== -1) {
        const [from, to] = startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
        selectedMetadataKeys = keys.slice(from, to + 1);
        return;
      }
    }

    if (isMulti) {
      if (selectedMetadataKeys.includes(key)) {
        selectedMetadataKeys = selectedMetadataKeys.filter((k) => k !== key);
      } else {
        selectedMetadataKeys = [...selectedMetadataKeys, key];
      }
      lastSelectedMetadataKey = key;
      return;
    }

    selectedMetadataKeys = [key];
    lastSelectedMetadataKey = key;
  }

  function focusMetadataKeyElement(key: string): void {
    if (typeof document === 'undefined') return;
    const target = document.querySelector<HTMLElement>(
      `[data-metadata-key="${CSS.escape(key)}"]`
    );
    target?.focus();
  }

  async function deleteSelectedMetadataFields(keysToDelete?: string[]): Promise<void> {
    if (!featureFlags.isEnabled('settings.metadata.delete')) return;
    if (!metadata || store.isReadOnly) return;

    const targets = keysToDelete && keysToDelete.length > 0 ? keysToDelete : selectedMetadataKeys;
    if (targets.length === 0) return;

    const currentVisibleKeys = [...selectableMetadataKeys];
    const firstTargetIdx = currentVisibleKeys.findIndex((k) => targets.includes(k));

    const updates: DocumentMetadataUpdate = {};
    const customKeysToRemove: string[] = [];
    const persistedCustomKeysToRemove: string[] = [];

    for (const key of targets) {
      if ((STANDARD_METADATA_KEYS as readonly string[]).includes(key)) {
        const stdKey = key as EditableStandardField;
        updates[stdKey] = '';
        metadata[stdKey] = '';
      } else {
        customKeysToRemove.push(key);
        const existingRow = customFieldEntries.find((entry) => entry.key === key);
        if (existingRow?.persistedKey) {
          persistedCustomKeysToRemove.push(existingRow.persistedKey);
        } else if (!existingRow) {
          persistedCustomKeysToRemove.push(key);
        }
      }
    }

    if (customKeysToRemove.length > 0) {
      const removeSet = new Set(customKeysToRemove);
      customFieldEntries = customFieldEntries.filter((entry) => !removeSet.has(entry.key));
      syncMetadataCustomRecord();
      if (persistedCustomKeysToRemove.length > 0) {
        updates.removeKeys = persistedCustomKeysToRemove;
      }
    }

    selectedMetadataKeys = selectedMetadataKeys.filter((k) => !targets.includes(k));
    if (lastSelectedMetadataKey && targets.includes(lastSelectedMetadataKey)) {
      lastSelectedMetadataKey = selectedMetadataKeys[selectedMetadataKeys.length - 1] ?? null;
    }
    editingKey = null;
    isActivelyTypingInKey = false;

    const remainingKeys = currentVisibleKeys.filter((k) => !targets.includes(k));
    if (remainingKeys.length > 0 && firstTargetIdx !== -1) {
      const nextFocusKey =
        remainingKeys[Math.min(firstTargetIdx, remainingKeys.length - 1)];
      if (nextFocusKey) {
        selectedMetadataKeys = [nextFocusKey];
        lastSelectedMetadataKey = nextFocusKey;
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => {
            focusMetadataKeyElement(nextFocusKey);
          });
        }
      }
    }

    if (
      Object.keys(updates).length > 0 &&
      (updates.removeKeys !== undefined ||
        STANDARD_METADATA_KEYS.some((k) => updates[k] !== undefined))
    ) {
      await enqueueMetadataUpdate(updates);
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (store.isReadOnly) {
      event.preventDefault();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      (event.currentTarget as HTMLElement).blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      const el = event.currentTarget as HTMLElement;
      el.textContent = editingInitialValue || '-';
      el.blur();
    }
  }

  function handlePaste(event: ClipboardEvent): void {
    if (store.isReadOnly) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') ?? '';
    const cleanText = text.replace(/[\r\n]+/g, ' ').trim();
    document.execCommand('insertText', false, cleanText);
  }

  async function handleApplySecurity(): Promise<void> {
    if (!userPassword && !ownerPassword) return;
    isApplyingSecurity = true;
    securityMessage = null;
    securityError = null;
    try {
      await actions.applyPasswordSecurity(userPassword, ownerPassword);
      userPassword = '';
      ownerPassword = '';
      securityMessage = 'Password protection successfully applied.';
      metadata = actions.service.document.getMetadata();
    } catch (err) {
      securityError = err instanceof Error ? err.message : 'Failed to apply password security.';
    } finally {
      isApplyingSecurity = false;
    }
  }

  async function handleRemoveSecurity(): Promise<void> {
    isRemovingSecurity = true;
    securityMessage = null;
    securityError = null;
    try {
      await actions.removePasswordSecurity(ownerPassword || undefined);
      ownerPassword = '';
      securityMessage = 'Document security removed successfully.';
      metadata = actions.service.document.getMetadata();
    } catch (err) {
      securityError = err instanceof Error ? err.message : 'Failed to remove security.';
    } finally {
      isRemovingSecurity = false;
    }
  }

  async function handleUnlockForms(): Promise<void> {
    isUnlockingForms = true;
    securityMessage = null;
    securityError = null;
    try {
      const res = await actions.unlockForms();
      if (res.fieldsUnlockedCount > 0 || res.annotationsUnlockedCount > 0) {
        securityMessage = `Unlocked ${res.fieldsUnlockedCount} form fields (${res.annotationsUnlockedCount} widgets).`;
      } else {
        securityMessage = 'All form fields are already editable.';
      }
    } catch (err) {
      securityError = err instanceof Error ? err.message : 'Failed to unlock form fields.';
    } finally {
      isUnlockingForms = false;
    }
  }

  function triggerTool(toolName: string): void {
    store.activeMockupTool = toolName;
  }
</script>

<div class="panel-root">
  <!-- Document info and metadata -->
  <SidebarSection title="Document Info & Metadata" borderBottom={true}>
    {#if store.isReadOnly}
      <div class="panel-metric-banner mb-2 flex items-center justify-between py-1.5 px-2 bg-muted/40 rounded-md border border-border/50 text-[11px] text-muted-foreground">
        <div class="flex items-center gap-1.5">
          <Eye class="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span>Viewing Mode (Read-only)</span>
        </div>
        <span class="panel-status-pill">Read-only</span>
      </div>
    {/if}
    {#if metadata}
      <div class="panel-metric-banner mb-2">
        <div class="panel-key-value-grid">
          <div class="panel-key-label">Title</div>
          <div
            class="panel-value-text cursor-text outline-none select-text"
            contenteditable="plaintext-only"
            role="textbox"
            aria-label="Title"
            tabindex={0}
            spellcheck={false}
            title={editingKey === 'title' ? '' : (metadata.title || '-')}
            onfocus={(e) => handleFocus('title', e)}
            onblur={(e) => handleBlur('title', e)}
            onkeydown={handleKeydown}
            onpaste={handlePaste}
          >
            {metadata.title || '-'}
          </div>

          <div class="panel-key-label">Author</div>
          <div
            class="panel-value-text cursor-text outline-none select-text"
            contenteditable="plaintext-only"
            role="textbox"
            aria-label="Author"
            tabindex={0}
            spellcheck={false}
            title={editingKey === 'author' ? '' : (metadata.author || '-')}
            onfocus={(e) => handleFocus('author', e)}
            onblur={(e) => handleBlur('author', e)}
            onkeydown={handleKeydown}
            onpaste={handlePaste}
          >
            {metadata.author || '-'}
          </div>

          <div class="panel-key-label">Size</div>
          <div class="panel-value-text" title={formattedDocumentSize}>
            {formattedDocumentSize}
          </div>

          <div class="panel-key-label">Subject</div>
          <div
            class="panel-value-text cursor-text outline-none select-text"
            contenteditable="plaintext-only"
            role="textbox"
            aria-label="Subject"
            tabindex={0}
            spellcheck={false}
            title={editingKey === 'subject' ? '' : (metadata.subject || '-')}
            onfocus={(e) => handleFocus('subject', e)}
            onblur={(e) => handleBlur('subject', e)}
            onkeydown={handleKeydown}
            onpaste={handlePaste}
          >
            {metadata.subject || '-'}
          </div>

          <div class="panel-key-label">Creator</div>
          <div
            class="panel-value-text cursor-text outline-none select-text"
            contenteditable="plaintext-only"
            role="textbox"
            aria-label="Creator"
            tabindex={0}
            spellcheck={false}
            title={editingKey === 'creator' ? '' : (metadata.creator || '-')}
            onfocus={(e) => handleFocus('creator', e)}
            onblur={(e) => handleBlur('creator', e)}
            onkeydown={handleKeydown}
            onpaste={handlePaste}
          >
            {metadata.creator || '-'}
          </div>

          <div class="panel-key-label">Producer</div>
          <div
            class="panel-value-text cursor-text outline-none select-text"
            contenteditable="plaintext-only"
            role="textbox"
            aria-label="Producer"
            tabindex={0}
            spellcheck={false}
            title={editingKey === 'producer' ? '' : (metadata.producer || '-')}
            onfocus={(e) => handleFocus('producer', e)}
            onblur={(e) => handleBlur('producer', e)}
            onkeydown={handleKeydown}
            onpaste={handlePaste}
          >
            {metadata.producer || '-'}
          </div>

          {#if showAllFields}
            <div class="panel-key-label">Keywords</div>
            <div
              class="panel-value-text cursor-text outline-none select-text"
              contenteditable="plaintext-only"
              role="textbox"
              aria-label="Keywords"
              tabindex={0}
              spellcheck={false}
              title={editingKey === 'keywords' ? '' : (metadata.keywords || '-')}
              onfocus={(e) => handleFocus('keywords', e)}
              onblur={(e) => handleBlur('keywords', e)}
              onkeydown={handleKeydown}
              onpaste={handlePaste}
            >
              {metadata.keywords || '-'}
            </div>

            {#if metadata.creationDateFormatted}
              <div class="panel-key-label">Created</div>
              <div class="panel-value-text" title={metadata.creationDateFormatted}>
                {metadata.creationDateFormatted}
              </div>
            {/if}

            {#if metadata.modDateFormatted}
              <div class="panel-key-label">Modified</div>
              <div class="panel-value-text" title={metadata.modDateFormatted}>
                {metadata.modDateFormatted}
              </div>
            {/if}

            {#if metadata.trapped && metadata.trapped !== 'Unknown'}
              <div class="panel-key-label">Trapped</div>
              <div class="panel-value-text">{metadata.trapped}</div>
            {/if}

            <!-- Dynamic Custom Metadata Fields -->
            {#if metadata.customMetadata && Object.keys(metadata.customMetadata).length > 0}
              {#each Object.entries(metadata.customMetadata) as [key, val] (key)}
                <div class="panel-key-label flex items-center gap-1">
                  <span class="truncate" title={key}>{key}</span>
                  <Badge variant="secondary" class="text-[8px] px-0.5 py-0 h-3 leading-none font-sans">
                    custom
                  </Badge>
                </div>
                <div
                  class="panel-value-text cursor-text outline-none select-text"
                  contenteditable="plaintext-only"
                  role="textbox"
                  aria-label={key}
                  tabindex={0}
                  spellcheck={false}
                  title={editingKey === `custom:${key}` ? '' : (val || '-')}
                  onfocus={(e) => handleCustomFocus(key, e)}
                  onblur={(e) => handleCustomBlur(key, e)}
                  onkeydown={handleKeydown}
                  onpaste={handlePaste}
                >
                  {val || '-'}
                </div>
              {/each}
            {/if}
          {/if}
        </div>

        {#if metadata.allEntries && metadata.allEntries.length > 5}
          <button
            type="button"
            class="panel-action-link-primary flex items-center gap-1 self-start pt-0.5 rounded-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-expanded={showAllFields}
            onclick={() => (showAllFields = !showAllFields)}
          >
            {#if showAllFields}
              <ChevronDown class="h-3 w-3" aria-hidden="true" /> Show fewer fields
            {:else}
              <ChevronRight class="h-3 w-3" aria-hidden="true" /> Show all {metadata.allEntries.length} metadata fields
            {/if}
          </button>
        {/if}
      </div>
    {:else}
      <div class="text-xs text-muted-foreground flex items-center gap-1.5 mb-2">
        <Info class="h-3.5 w-3.5" /> No document loaded
      </div>
    {/if}

    <div class="panel-action-stack">
      {#if featureFlags.isEnabled('document-info')}
      <Button
        variant="panel"
        onclick={() => actions.openDocumentInfoDialog()}
        disabled={!store.isDocumentLoaded}
      >
        <FileText class="panel-icon-sm text-primary" /> Get ALL Info on PDF
      </Button>
      {/if}

      {#if featureFlags.isEnabled('settings.toc')}
      <Button
        variant="panel"
        onclick={() => triggerTool('Edit Table of Contents')}
        disabled={!store.isDocumentLoaded}
      >
        <ListTree class="panel-icon-sm text-muted-foreground" /> Edit Table of Contents
      </Button>
      {/if}

      {#if featureFlags.isEnabled('sanitization')}
      <Button
        variant="panel"
        onclick={() => actions.openSanitizeDialog()}
        disabled={!store.isDocumentLoaded}
      >
        <ShieldCheck class="panel-icon-sm text-primary" /> Sanitise Document
      </Button>
      {/if}
    </div>
  </SidebarSection>


  <!-- Password protection and security -->
  {#if featureFlags.isEnabled('security')}
  <SidebarSection title="Password Security & Access" borderBottom={true}>
    <p class="panel-description">Set or remove document passwords and permissions.</p>

    {#if securityMessage}
      <div class="mb-2 panel-status-pill">
        <Check class="h-3 w-3 shrink-0" />
        <span>{securityMessage}</span>
      </div>
    {/if}

    {#if securityError}
      <div class="mb-2 panel-error-pill">
        <AlertCircle class="h-3 w-3 shrink-0" />
        <span>{securityError}</span>
      </div>
    {/if}

    <div class="flex flex-col gap-2.5">
      {#if featureFlags.isEnabled('security.password')}
        {#if isDocumentEncrypted}
          <div class="panel-card-inset">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <Lock class="h-3.5 w-3.5 text-primary" /> Document Protected
              </div>
              <Badge variant="default" class="text-[10px]">Encrypted</Badge>
            </div>
            <p class="text-[11px] text-muted-foreground">
              This document has active password protection and access controls.
            </p>

            {#if !store.isOwnerUnlocked}
              <div class="field-group-sm pt-1">
                <Label for="owner-unlock-pwd" class="field-label">Owner Password (to remove)</Label>
                <Input
                  id="owner-unlock-pwd"
                  type="password"
                  placeholder="Enter owner password..."
                  bind:value={ownerPassword}
                  class="field-input"
                />
              </div>
            {/if}

            <Button
              variant="outline"
              size="sm"
              class="w-full text-xs h-7 justify-center text-destructive hover:text-destructive mt-1"
              onclick={handleRemoveSecurity}
              disabled={!store.isDocumentLoaded || isRemovingSecurity || store.isReadOnly}
            >
              {#if isRemovingSecurity}
                <Loader2 class="h-3 w-3 mr-1.5 animate-spin" /> Removing Security...
              {:else}
                <Unlock class="h-3 w-3 mr-1.5" /> Remove Password Security
              {/if}
            </Button>
          </div>
        {:else}
          <div class="field-group-sm">
            <Label for="user-password" class="field-label">Document Open Password</Label>
            <Input
              id="user-password"
              type="password"
              placeholder="Enter user password..."
              bind:value={userPassword}
              class="field-input"
              disabled={isApplyingSecurity || store.isReadOnly}
            />
          </div>

          <div class="field-group-sm">
            <Label for="owner-password" class="field-label">Permissions / Owner Password</Label>
            <Input
              id="owner-password"
              type="password"
              placeholder="Enter owner password..."
              bind:value={ownerPassword}
              class="field-input"
              disabled={isApplyingSecurity || store.isReadOnly}
            />
          </div>

          <Button
            variant="secondary"
            size="sm"
            class="w-full text-xs h-8"
            onclick={handleApplySecurity}
            disabled={!store.isDocumentLoaded || (!userPassword && !ownerPassword) || isApplyingSecurity || store.isReadOnly}
          >
            {#if isApplyingSecurity}
              <Loader2 class="h-3.5 w-3.5 mr-2 animate-spin" /> Encrypting...
            {:else}
              <Lock class="h-3.5 w-3.5 mr-2 text-primary" /> Apply Password Security
            {/if}
          </Button>
        {/if}
      {/if}

      <div class="panel-action-stack mt-1">
        {#if featureFlags.isEnabled('security.unlock-forms')}
        <Button
          variant="panel"
          onclick={handleUnlockForms}
          disabled={!store.isDocumentLoaded || isUnlockingForms || store.isReadOnly}
        >
          {#if isUnlockingForms}
            <Loader2 class="panel-icon-sm animate-spin text-warning" /> Unlocking...
          {:else}
            <Unlock class="panel-icon-sm text-warning" /> Unlock Forms
          {/if}
        </Button>
        {/if}

        {#if featureFlags.isEnabled('security.permissions')}
        <Button
          variant="panel"
          onclick={() => actions.openPermissionsDialog()}
          disabled={!store.isDocumentLoaded || store.isReadOnly}
        >
          <FileKey class="panel-icon-sm text-muted-foreground" /> Permissions
        </Button>
        {/if}
      </div>
    </div>
  </SidebarSection>
  {/if}

  <!-- Repair and developer tools -->
  {#if featureFlags.isEnabled('tools')}
  <SidebarSection title="Repair & Developer Info" borderBottom={false}>
    <p class="panel-description">Repair damaged PDFs or inspect embedded JavaScript.</p>

    <div class="panel-action-stack">
      {#if featureFlags.isEnabled('tools.repair')}
      <Button
        variant="panel"
        onclick={() => triggerTool('Repair Damaged PDF')}
        disabled={!store.isDocumentLoaded}
      >
        <Wrench class="panel-icon-sm text-warning" /> Repair Damaged PDF
      </Button>
      {/if}

      {#if featureFlags.isEnabled('tools.javascript')}
      <Button
        variant="panel"
        onclick={() => triggerTool('Show Embedded JavaScript')}
        disabled={!store.isDocumentLoaded}
      >
        <Code2 class="panel-icon-sm text-primary" /> Show Embedded JavaScript
      </Button>
      {/if}

      {#if featureFlags.isEnabled('components.gallery')}
      <Button
        variant="panel"
        onclick={() => store.openComponentGalleryDialog()}
      >
        <Palette class="panel-icon-sm text-primary" /> UI Component Gallery
      </Button>
      {/if}

      <div class="flex items-center justify-between pt-1">
        <span class="text-xs text-muted-foreground">Encryption Standard</span>
        {#if isDocumentEncrypted}
          <Badge variant="default" class="text-[10px]">
            <ShieldCheck class="h-3 w-3 mr-1" /> Encrypted
          </Badge>
        {:else}
          <Badge variant="outline" class="text-[10px]">
            <FileKey class="h-3 w-3 mr-1" /> Standard
          </Badge>
        {/if}
      </div>
    </div>
  </SidebarSection>
  {/if}
</div>

