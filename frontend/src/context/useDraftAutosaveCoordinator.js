import { useCallback, useEffect, useRef } from "react";

const AUTOSAVE_DEBOUNCE_MS = 700;

function markRevisionConflict(setMetadata, error) {
  setMetadata((prev) => (
    prev.saveState === "conflict"
      ? prev
      : {
        ...prev,
        saveState: "conflict",
        lastSaveErrorMessage: error?.message || "This draft was updated elsewhere.",
        lastSaveErrorCode: error?.code || "DRAFT_REVISION_CONFLICT",
      }
  ));
}

function sameDocumentIdentity(a, b) {
  return Boolean(
    a &&
    b &&
    a.documentId === b.documentId &&
    a.versionId === b.versionId
  );
}

function sameRequestedDocument(a, b) {
  return Boolean(a && b && a.documentId === b.documentId);
}

export function useDraftAutosaveCoordinator({
  draft,
  metadata,
  setMetadata,
  serializeDraft,
  getCurrentIdentity,
  getResponseIdentity,
  persistDocument,
  onHydrate,
  onCanonicalSaveResponse,
  handleSaveError,
  getSaveErrorPatch,
  isTransientlyPaused,
  onAutosaveError,
  onQueuedSaveError,
}) {
  const draftRef = useRef(draft);
  const metadataRef = useRef(metadata);
  const saveRequestIdRef = useRef(0);
  const latestAppliedSaveRequestIdRef = useRef(0);
  const saveInFlightPromiseRef = useRef(null);
  const pendingSaveRequestedRef = useRef(false);
  const loadedIdentityRef = useRef(null);
  const targetIdentityRef = useRef(null);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    metadataRef.current = metadata;
  }, [metadata]);

  const beginHydrationTarget = useCallback((identity) => {
    targetIdentityRef.current = identity;
  }, []);

  const resetHydrationIdentity = useCallback(() => {
    loadedIdentityRef.current = null;
    targetIdentityRef.current = null;
  }, []);

  const hydrate = useCallback((response, options = {}) => {
    const responseIdentity = getResponseIdentity(response);

    if (!options.force) {
      const declaredTarget = targetIdentityRef.current;
      const isStaleAgainstDeclaredTarget =
        declaredTarget != null &&
        !sameRequestedDocument(declaredTarget, responseIdentity);

      if (isStaleAgainstDeclaredTarget) {
        return false;
      }

      const isSameDocumentAlreadyLoaded = sameDocumentIdentity(
        loadedIdentityRef.current,
        responseIdentity
      );

      if (isSameDocumentAlreadyLoaded) {
        const currentSaveState = metadataRef.current.saveState;
        if (
          currentSaveState === "dirty" ||
          currentSaveState === "saving" ||
          currentSaveState === "conflict"
        ) {
          return false;
        }
      }
    }

    onHydrate(response, {
      ...options,
      source: "hydrate",
    });
    loadedIdentityRef.current = responseIdentity;
    targetIdentityRef.current = responseIdentity;
    return true;
  }, [getResponseIdentity, onHydrate]);

  const persistDraftNow = useCallback(async (
    overrideDraft = null,
    overrideIdentity = null
  ) => {
    const currentMetadata = metadataRef.current;
    const resolvedIdentity = getCurrentIdentity(currentMetadata);

    if (
      !currentMetadata.loadedFromBackend ||
      !resolvedIdentity ||
      isTransientlyPaused?.(currentMetadata)
    ) {
      return null;
    }

    const identity = overrideIdentity || resolvedIdentity;
    const nextDraft = overrideDraft || draftRef.current;
    const payload = serializeDraft(nextDraft);
    const signature = JSON.stringify(payload);

    if (signature === currentMetadata.lastPersistedSignature) {
      return null;
    }

    if (saveInFlightPromiseRef.current) {
      pendingSaveRequestedRef.current = true;
      return saveInFlightPromiseRef.current;
    }

    const requestId = saveRequestIdRef.current + 1;
    saveRequestIdRef.current = requestId;

    setMetadata((prev) => (
      prev.saveState === "saving"
        ? prev
        : { ...prev, saveState: "saving" }
    ));

    const isStillCurrentTarget = () => sameDocumentIdentity(
      targetIdentityRef.current,
      identity
    );

    const runSave = async () => {
      if (!isStillCurrentTarget()) {
        return null;
      }

      const response = await persistDocument({
        identity,
        payload,
        metadata: currentMetadata,
      });

      if (!isStillCurrentTarget()) {
        return response;
      }

      const currentSignature = JSON.stringify(serializeDraft(draftRef.current));
      const hasNewerLocalEdits = currentSignature !== signature;
      const isOlderThanAppliedResponse =
        requestId < latestAppliedSaveRequestIdRef.current;

      if (hasNewerLocalEdits || isOlderThanAppliedResponse) {
        setMetadata((prev) => {
          const latestLocalSignature = JSON.stringify(serializeDraft(draftRef.current));
          const hasUnsavedLocalEdits =
            latestLocalSignature !== prev.lastPersistedSignature;

          if (!hasUnsavedLocalEdits) {
            return prev;
          }

          const hasNewerSaveRequestInFlight = requestId < saveRequestIdRef.current;
          const nextSaveState = hasNewerSaveRequestInFlight ? "saving" : "dirty";

          return prev.saveState === nextSaveState
            ? prev
            : { ...prev, saveState: nextSaveState };
        });

        return response;
      }

      latestAppliedSaveRequestIdRef.current = requestId;
      onCanonicalSaveResponse(response, {
        source: "canonical-save",
        requestId,
        requestSignature: signature,
      });
      loadedIdentityRef.current = getResponseIdentity(response);
      return response;
    };

    const savePromise = (async () => {
      let saveError = null;
      let result = null;

      try {
        result = await runSave();
      } catch (error) {
        if (error?.code === "DRAFT_REVISION_CONFLICT") {
          saveError = error;
          markRevisionConflict(setMetadata, error);
        } else {
          const didHandleError = await handleSaveError?.(error, {
            currentMetadata,
            hydrate,
          });

          if (!didHandleError) {
            saveError = error;
            setMetadata((prev) => ({
              ...prev,
              saveState: "error",
              ...(getSaveErrorPatch?.(error, prev) || {}),
            }));
          }
        }
      } finally {
        saveInFlightPromiseRef.current = null;
      }

      let followUpPromise = null;

      if (pendingSaveRequestedRef.current) {
        pendingSaveRequestedRef.current = false;
        const latestMetadata = metadataRef.current;

        if (
          latestMetadata.saveState !== "conflict" &&
          !isTransientlyPaused?.(latestMetadata)
        ) {
          const latestDraft = draftRef.current;
          const latestSignature = JSON.stringify(serializeDraft(latestDraft));

          if (latestSignature !== latestMetadata.lastPersistedSignature) {
            followUpPromise = persistDraftNow(latestDraft);

            if (onQueuedSaveError) {
              followUpPromise = followUpPromise.catch((queuedError) => {
                onQueuedSaveError(queuedError, metadataRef.current);
                throw queuedError;
              });
            }
          }
        }
      }

      if (followUpPromise) {
        return followUpPromise;
      }

      if (saveError) {
        throw saveError;
      }

      return result;
    })();

    saveInFlightPromiseRef.current = savePromise;
    return savePromise;
  }, [
    getCurrentIdentity,
    getResponseIdentity,
    getSaveErrorPatch,
    handleSaveError,
    hydrate,
    isTransientlyPaused,
    onCanonicalSaveResponse,
    onQueuedSaveError,
    persistDocument,
    serializeDraft,
    setMetadata,
  ]);

  const {
    documentId: currentDocumentId,
    versionId: currentVersionId,
  } = getCurrentIdentity(metadata) || {};

  // Keep dirty detection document-level in Phase 3; serializers remain an
  // adapter boundary so later phases can replace that policy independently.
  useEffect(() => {
    if (
      !metadata.loadedFromBackend ||
      !currentDocumentId ||
      !currentVersionId ||
      metadataRef.current.saveState === "conflict" ||
      isTransientlyPaused?.(metadataRef.current)
    ) {
      return undefined;
    }

    const signature = JSON.stringify(serializeDraft(draft));
    if (signature === metadata.lastPersistedSignature) {
      return undefined;
    }

    setMetadata((prev) => (
      prev.saveState === "saving" || prev.saveState === "dirty"
        ? prev
        : { ...prev, saveState: "dirty" }
    ));

    const draftSnapshot = draft;
    const identitySnapshot = {
      documentId: currentDocumentId,
      versionId: currentVersionId,
    };
    const timeoutId = window.setTimeout(() => {
      persistDraftNow(draftSnapshot, identitySnapshot).catch((error) => {
        onAutosaveError?.(error, metadataRef.current);
      });
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [
    currentDocumentId,
    currentVersionId,
    draft,
    isTransientlyPaused,
    metadata.lastPersistedSignature,
    metadata.loadedFromBackend,
    onAutosaveError,
    persistDraftNow,
    serializeDraft,
    setMetadata,
  ]);

  return {
    beginHydrationTarget,
    draftRef,
    hydrate,
    metadataRef,
    persistDraftNow,
    resetHydrationIdentity,
  };
}
