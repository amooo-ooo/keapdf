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

  function handleCustomKeyKeydown(key: string, event: KeyboardEvent): void {
    if (store.isReadOnly) {
      event.preventDefault();
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      isActivelyTypingInKey = false;
      const keys = selectableMetadataKeys;
      const currentIdx = keys.indexOf(key);
      if (currentIdx === -1) return;
      const nextIdx =
        event.key === 'ArrowDown'
          ? Math.min(keys.length - 1, currentIdx + 1)
          : Math.max(0, currentIdx - 1);
      const nextKey = keys[nextIdx];
      if (!nextKey) return;

      if (event.shiftKey && lastSelectedMetadataKey) {
        const anchorIdx = keys.indexOf(lastSelectedMetadataKey);
        const [from, to] =
          anchorIdx !== -1 && anchorIdx <= nextIdx
            ? [anchorIdx, nextIdx]
            : [nextIdx, anchorIdx !== -1 ? anchorIdx : currentIdx];
        selectedMetadataKeys = keys.slice(from, to + 1);
      } else {
        selectedMetadataKeys = [nextKey];
        lastSelectedMetadataKey = nextKey;
      }
      focusMetadataKeyElement(nextKey);
      return;
    }

    if (event.key === 'Backspace' || event.key === 'Delete') {
      if (!featureFlags.isEnabled('settings.metadata.delete')) return;
      const el = event.currentTarget as HTMLElement;
      const currentText = el.textContent?.trim() ?? '';
      const hasMultiSelection = selectedMetadataKeys.length > 1;
      const isKeySelected = selectedMetadataKeys.includes(key);

      if (hasMultiSelection || !currentText || (isKeySelected && !isActivelyTypingInKey)) {
        event.preventDefault();
        const targets =
          selectedMetadataKeys.length > 0 && selectedMetadataKeys.includes(key)
            ? [...selectedMetadataKeys]
            : [key];
        void deleteSelectedMetadataFields(targets);
        return;
      }
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      isActivelyTypingInKey = false;
      (event.currentTarget as HTMLElement).blur();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      isActivelyTypingInKey = false;
      const el = event.currentTarget as HTMLElement;
      el.textContent = editingInitialKey || key;
      el.blur();
      return;
    }

    if (
      event.key === 'ArrowLeft' ||
      event.key === 'ArrowRight' ||
      event.key === 'Home' ||
      event.key === 'End' ||
      (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey)
    ) {
      isActivelyTypingInKey = true;
    }
  }

  function handleMetadataContainerKeydown(event: KeyboardEvent): void {
    if (store.isReadOnly || store.leftPanelMode !== 'settings') return;
    if (event.defaultPrevented) return;
    if (event.key !== 'Backspace' && event.key !== 'Delete') return;
    if (!featureFlags.isEnabled('settings.metadata.delete')) return;
    if (selectedMetadataKeys.length === 0) return;

    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        target.getAttribute('contenteditable') !== null)
    ) {
      return;
    }

    event.preventDefault();
    void deleteSelectedMetadataFields([...selectedMetadataKeys]);
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

  async function handleCopyRawDictXmp(): Promise<void> {
    if (!metadata) return;
    const parts: string[] = [];

    const rawDict: Record<string, string> = {};
    if (metadata.allEntries && metadata.allEntries.length > 0) {
      for (const entry of metadata.allEntries) {
        rawDict[entry.rawKey || `/${entry.key}`] = entry.value;
      }
    } else {
      if (metadata.title) rawDict['/Title'] = metadata.title;
      if (metadata.author) rawDict['/Author'] = metadata.author;
      if (metadata.subject) rawDict['/Subject'] = metadata.subject;
      if (metadata.keywords) rawDict['/Keywords'] = metadata.keywords;
      if (metadata.creator) rawDict['/Creator'] = metadata.creator;
      if (metadata.producer) rawDict['/Producer'] = metadata.producer;
      if (metadata.creationDate) rawDict['/CreationDate'] = metadata.creationDate;
      if (metadata.modDate) rawDict['/ModDate'] = metadata.modDate;
      if (metadata.trapped && metadata.trapped !== 'Unknown') rawDict['/Trapped'] = metadata.trapped;
      if (metadata.customMetadata) {
        for (const [k, v] of Object.entries(metadata.customMetadata)) {
          rawDict[`/${k}`] = v;
        }
      }
    }

    parts.push(`// Raw Info Dictionary\n${JSON.stringify(rawDict, null, 2)}`);

    if (metadata.xmpString) {
      parts.push(`<!-- XMP Metadata Stream -->\n${metadata.xmpString}`);
    }

    const payload = parts.join('\n\n');
    try {
      await navigator.clipboard.writeText(payload);
      isRawDictCopied = true;
      setTimeout(() => {
        isRawDictCopied = false;
      }, 2000);
    } catch (err) {
      console.warn('Failed to copy raw dictionary and XMP stream:', err);
    }
  }

  function triggerTool(toolName: string): void {
    store.activeMockupTool = toolName;
  }
</script>

<svelte:window onkeydown={handleMetadataContainerKeydown} />

<div class="panel-root">
  <!-- note: document info -->
  <SidebarSection title="Document Info" borderBottom={true}>
    {#if store.isReadOnly}
      <div class="panel-metric-banner flex items-center justify-between py-1.5 px-2 bg-muted/40 rounded-md border border-border/50 text-[11px] text-muted-foreground">
        <div class="flex items-center gap-1.5">
          <Eye class="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span>Viewing Mode (Read-only)</span>
        </div>
        <span class="panel-status-pill">Read-only</span>
      </div>
    {/if}
    {#if metadata}
      <div class="panel-metric-banner">
        <div class="panel-key-value-grid">
          <div class="panel-key-label">File Name</div>
          <div class="panel-value-text truncate" title={store.fileName}>
            {store.fileName}
          </div>

          <div class="panel-key-label">Size</div>
          <div class="panel-value-text" title={formattedDocumentSize}>
            {formattedDocumentSize}
          </div>

          <div class="panel-key-label">Pages</div>
          <div class="panel-value-text">
            {metadata.pageCount || store.pageCount} {(metadata.pageCount || store.pageCount) === 1 ? 'page' : 'pages'}
          </div>

          <div class="panel-key-label">Specification</div>
          <div class="panel-value-text">
            PDF {metadata.pdfVersion || '1.4'}
          </div>

          <div class="panel-key-label">Created</div>
          <div class="panel-value-text" title={metadata.creationDateFormatted || '-'}>
            {metadata.creationDateFormatted || '-'}
          </div>

          <div class="panel-key-label">Modified</div>
          <div class="panel-value-text" title={metadata.modDateFormatted || '-'}>
            {metadata.modDateFormatted || '-'}
          </div>

          <div class="panel-key-label">Trapped</div>
          <div class="panel-value-text flex items-center">
            {#if metadata.trapped === 'True'}
              <Badge variant="default" class="text-[10px] py-0 leading-none">Trapped</Badge>
            {:else if metadata.trapped === 'False'}
              <Badge variant="outline" class="text-[10px] py-0 leading-none">Untrapped</Badge>
            {:else}
              <span class="text-muted-foreground">-</span>
            {/if}
          </div>

          <div class="panel-key-label">XMP Stream</div>
          <div class="panel-value-text flex items-center">
            {#if metadata.hasXmp}
              <Badge variant="default" class="text-[10px] py-0 leading-none">Embedded Packet</Badge>
            {:else}
              <span class="text-muted-foreground">None</span>
            {/if}
          </div>

          {#if metadata.keywordsArray && metadata.keywordsArray.length > 0}
            <div class="panel-key-label">Keywords & Tags</div>
            <div class="panel-value-text flex flex-wrap items-center gap-1">
              {#each metadata.keywordsArray as tag}
                <Badge variant="secondary" class="text-[10px] px-1.5 py-0 leading-none font-sans">
                  {tag}
                </Badge>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    {:else}
      <div class="text-xs text-muted-foreground flex items-center gap-1.5">
        <Info class="h-3.5 w-3.5" /> No document loaded
      </div>
    {/if}

    {#if featureFlags.isEnabled('settings.toc')}
      <div class="panel-action-stack">
        <Button
          variant="panel"
          onclick={() => triggerTool('Edit Table of Contents')}
          disabled={!store.isDocumentLoaded}
        >
          <ListTree class="panel-icon-sm text-muted-foreground" /> Edit Table of Contents
        </Button>
      </div>
    {/if}
  </SidebarSection>

  <!-- note: metadata -->
  <SidebarSection title="Metadata" borderBottom={true}>
    <p class="panel-description">Inspect and edit standard and custom PDF metadata properties.</p>
    {#if metadata}
      <div class="panel-metric-banner">
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

          <!-- note: dynamic custom metadata tags -->
          {#if visibleCustomEntries.length > 0}
            {#each visibleCustomEntries as customField (customField.id)}
              <!-- <Badge variant="secondary" class="text-[8px] px-0.5 py-0 h-3 leading-none font-sans">
                custom
              </Badge> -->
              <div
                class="panel-key-label rounded-xs px-1 -mx-1 cursor-text outline-none select-text transition-colors {selectedMetadataKeys.includes(customField.key) ? 'bg-secondary text-foreground ring-1 ring-ring' : 'focus-visible:ring-1 focus-visible:ring-ring'}"
                contenteditable="plaintext-only"
                role="textbox"
                aria-label={`Metadata key ${customField.key}`}
                data-selected={selectedMetadataKeys.includes(customField.key)}
                tabindex={0}
                spellcheck={false}
                data-metadata-key={customField.key}
                data-metadata-custom-key={customField.key}
                title={editingKey === `custom-key:${customField.key}` ? '' : customField.key}
                onclick={(e) => handleMetadataKeyClick(customField.key, e)}
                onfocus={(e) => handleCustomKeyFocus(customField.key, e)}
                onblur={(e) => handleCustomKeyBlur(customField.key, e)}
                onkeydown={(e) => handleCustomKeyKeydown(customField.key, e)}
                onpaste={handlePaste}
              >
                {customField.key}
              </div>
              <div
                class="panel-value-text rounded-xs px-1 -mx-1 cursor-text outline-none select-text transition-colors {selectedMetadataKeys.includes(customField.key) ? 'bg-secondary/60 text-foreground' : ''}"
                contenteditable="plaintext-only"
                role="textbox"
                aria-label={customField.key}
                tabindex={0}
                spellcheck={false}
                data-metadata-row-id={customField.id}
                data-metadata-custom-value={customField.key}
                title={editingKey === `custom:${customField.key}` ? '' : (customField.value || '-')}
                onfocus={(e) => handleCustomFocus(customField.key, e)}
                onblur={(e) => handleCustomBlur(customField.key, e)}
                onkeydown={handleKeydown}
                onpaste={handlePaste}
              >
                {customField.value || '-'}
              </div>
            {/each}
          {/if}
        </div>

        {#if totalMetadataCount > 8}
          <button
            type="button"
            class="panel-action-link-primary flex items-center gap-1 self-start pt-0.5 rounded-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-expanded={showAllFields}
            onclick={() => (showAllFields = !showAllFields)}
          >
            {#if showAllFields}
              <ChevronDown class="h-3 w-3" aria-hidden="true" /> Show fewer fields
            {:else}
              <ChevronRight class="h-3 w-3" aria-hidden="true" /> Show all {totalMetadataCount} metadata fields
            {/if}
          </button>
        {/if}
      </div>
    {:else}
      <div class="text-xs text-muted-foreground flex items-center gap-1.5">
        <Info class="h-3.5 w-3.5" /> No document loaded
      </div>
    {/if}

    <div class="panel-action-stack">
      {#if featureFlags.isEnabled('settings.metadata.add')}
        <Button
          variant="panel"
          onclick={handleAddMetadataTag}
          disabled={!store.isDocumentLoaded || store.isReadOnly}
        >
          <Plus class="panel-icon-sm" /> Add Metadata Tag
        </Button>
      {/if}

      <Button
        variant="panel"
        onclick={handleCopyRawDictXmp}
        disabled={!store.isDocumentLoaded}
        title="Copy raw Info dictionary and XMP stream to clipboard"
      >
        {#if isRawDictCopied}
          <Check class="panel-icon-sm" /> Copied Raw Dict & XMP
        {:else}
          <Copy class="panel-icon-sm" /> Copy Raw Dict & XMP Stream
        {/if}
      </Button>
    </div>
  </SidebarSection>

  <!-- note: password protection and access permissions section -->
  {#if featureFlags.isEnabled('security')}
  <SidebarSection title="Password Security & Access" borderBottom={true}>
    <p class="panel-description">Set or remove document passwords and configure access permissions.</p>

    {#if securityMessage}
      <div role="status" class="panel-status-pill">
        <Check class="h-3 w-3 shrink-0" />
        <span>{securityMessage}</span>
      </div>
    {/if}

    {#if securityError}
      <div role="alert" class="panel-error-pill">
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
                <Lock class="h-3.5 w-3.5" /> Document Protected
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
              class="w-full text-xs h-7 justify-center text-foreground hover:text-foreground"
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
              <Lock class="h-3.5 w-3.5 mr-2" /> Apply Password Security
            {/if}
          </Button>
        {/if}
      {/if}

      <div class="panel-action-stack">
        {#if featureFlags.isEnabled('security.permissions')}
        <Button
          variant="panel"
          class="w-full"
          onclick={() => actions.openPermissionsDialog()}
          disabled={!store.isDocumentLoaded || store.isReadOnly}
        >
          <FileKey class="panel-icon-sm text-muted-foreground" /> Permissions
        </Button>
        {/if}

        {#if featureFlags.isEnabled('security.unlock-forms')}
        <Button
          variant="panel"
          class="w-full"
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
      </div>
    </div>
  </SidebarSection>
  {/if}

  <!-- note: unified signatures, e-sign actions, and statutory compliance verification -->
  {#if featureFlags.isEnabled('signatures') || featureFlags.isEnabled('security')}
  <SidebarSection title="Signatures & Verification" borderBottom={featureFlags.isEnabled('settings.repair-developer-info')}>
    <p class="panel-description">Digital PKCS#12 certificates, electronic signing, and statutory compliance verification.</p>

    {#if featureFlags.isEnabled('signatures')}
    <div class="panel-action-stack">
      {#if featureFlags.isEnabled('signatures.esign')}
      <Button
        variant="panel"
        class="w-full relative"
        onclick={() => actions.openEsignDialog('signatures')}
        disabled={!store.isDocumentLoaded || store.isReadOnly}
      >
        <PenTool class="panel-icon-sm" /> Add E-Sign
        {#if savedCount > 0}
          <span class="ml-auto bg-secondary text-foreground text-[10px] font-semibold px-1 rounded border border-border">
            {savedCount}
          </span>
        {/if}
      </Button>
      {/if}

      {#if featureFlags.isEnabled('signatures.cert-sign')}
      <Button
        variant="panel"
        class="w-full relative"
        onclick={() => actions.openCertSignDialog()}
        disabled={!store.isDocumentLoaded || store.isReadOnly}
      >
        <ShieldCheck class="panel-icon-sm" /> Cert Sign
        {#if featureFlags.isEnabled('signatures.cert-sign.saved') && savedCertCount > 0}
          <span class="ml-auto bg-secondary text-foreground text-[10px] font-semibold px-1 rounded border border-border">
            {savedCertCount}
          </span>
        {/if}
      </Button>
      {/if}

      {#if featureFlags.isEnabled('signatures.validate')}
      <Button
        variant="panel"
        class="w-full"
        onclick={() => actions.openValidateSignaturesDialog()}
        disabled={!store.isDocumentLoaded}
      >
        <CheckCircle2 class="panel-icon-sm" /> Validate
      </Button>
      {/if}

      {#if featureFlags.isEnabled('signatures.timestamp')}
      <Button
        variant="panel"
        class="w-full"
        onclick={() => triggerTool('Timestamp PDF')}
        disabled={!store.isDocumentLoaded || store.isReadOnly}
      >
        <Clock class="panel-icon-sm text-muted-foreground" /> Timestamp
      </Button>
      {/if}

      {#if featureFlags.isEnabled('signatures.shared')}
      <Button
        variant="panel"
        class="w-full"
        onclick={() => triggerTool('Shared Signing')}
        disabled={!store.isDocumentLoaded || store.isReadOnly}
      >
        <Users class="panel-icon-sm" /> Shared Signing Workflow
      </Button>
      {/if}
    </div>
    {/if}

    {#if featureFlags.isEnabled('security')}
    <SecurityComplianceSection
      {metadata}
      {signatureResults}
      {isValidatingSignatures}
      showEncryptionBanner={false}
      showHeader={false}
      onRefreshSignatures={loadSignatures}
      onOpenCertSign={() => actions.openCertSignDialog()}
      onOpenValidateDialog={() => actions.openValidateSignaturesDialog()}
    />
    {/if}
  </SidebarSection>
  {/if}

  <!-- note: repair and developer tools -->
  {#if featureFlags.isEnabled('settings.repair-developer-info')}
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
        <Code2 class="panel-icon-sm" /> Show Embedded JavaScript
      </Button>
      {/if}

      {#if featureFlags.isEnabled('components.gallery')}
      <Button
        variant="panel"
        onclick={() => store.openComponentGalleryDialog()}
      >
        <Palette class="panel-icon-sm" /> UI Component Gallery
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
