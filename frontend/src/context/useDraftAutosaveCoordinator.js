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
  metadataSourceRef = null,
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
  preparePersistence,
  onSuccessfulSaveResponse,
  onPersistenceSettled,
  shouldAutosave,
  autosaveTrigger,
}) {
  const draftRef = useRef(draft);
  const internalMetadataRef = useRef(metadata);
  const metadataRef = metadataSourceRef || internalMetadataRef;
  const saveRequestIdRef = useRef(0);
  const latestAppliedSaveRequestIdRef = useRef(0);
  const saveInFlightPromiseRef = useRef(null);
  const pendingSaveRequestedRef = useRef(false);
  const autosaveTimerRef = useRef(null);
  const loadedIdentityRef = useRef(null);
  const targetIdentityRef = useRef(null);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    metadataRef.current = metadata;
  }, [metadata, metadataRef]);

  const clearAutosaveTimer = useCallback(() => {
    if (autosaveTimerRef.current != null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  }, []);

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
  }, [getResponseIdentity, metadataRef, onHydrate]);

  const persistDraftNow = useCallback(async (
    overrideDraft = null,
    overrideIdentity = null
  ) => {
    clearAutosaveTimer();
    const initialMetadata = metadataRef.current;
    const resolvedIdentity = getCurrentIdentity(initialMetadata);

    if (
      !initialMetadata.loadedFromBackend ||
      !resolvedIdentity ||
      isTransientlyPaused?.(initialMetadata)
    ) {
      return null;
    }

    if (saveInFlightPromiseRef.current) {
      pendingSaveRequestedRef.current = true;
      return saveInFlightPromiseRef.current;
    }

    const requestId = saveRequestIdRef.current + 1;
    saveRequestIdRef.current = requestId;

    const savePromise = (async () => {
      let saveError = null;
      let result = null;
      let currentMetadata = initialMetadata;
      let identity = overrideIdentity || resolvedIdentity;
      let nextDraft = overrideDraft || draftRef.current;
      let payload = null;
      let signature = null;
      let preparationContext = null;
      let outcome = "skipped";

      try {
        const prepared = await preparePersistence({
          draft: draftRef.current,
          identity,
          metadata: metadataRef.current,
          requestId,
        });

        if (prepared) {
          currentMetadata = prepared.metadata || metadataRef.current;
          identity = prepared.identity || getCurrentIdentity(currentMetadata) || identity;
          nextDraft = prepared.draft || draftRef.current;
          preparationContext = prepared.context || null;
        } else {
          currentMetadata = metadataRef.current;
        }

        payload = serializeDraft(nextDraft);
        signature = JSON.stringify(payload);

        if (signature !== currentMetadata.lastPersistedSignature) {
          setMetadata((prev) => (
            prev.saveState === "saving"
              ? prev
              : { ...prev, saveState: "saving" }
          ));

          const isStillCurrentTarget = () => sameDocumentIdentity(
            targetIdentityRef.current,
            identity
          );

          if (isStillCurrentTarget()) {
            outcome = "requesting";
            const response = await persistDocument({
              identity,
              payload,
              metadata: currentMetadata,
            });
            result = response;
            outcome = "succeeded";

            if (isStillCurrentTarget()) {
              const currentSignature = JSON.stringify(serializeDraft(draftRef.current));
              const hasNewerLocalEdits = currentSignature !== signature;
              const isOlderThanAppliedResponse =
                requestId < latestAppliedSaveRequestIdRef.current;
              const didHandleResponse = await onSuccessfulSaveResponse?.(response, {
                source: "canonical-save",
                requestId,
                requestDraft: nextDraft,
                requestPayload: payload,
                requestSignature: signature,
                preparationContext,
                hasNewerLocalEdits,
                isOlderThanAppliedResponse,
              });

              if (didHandleResponse) {
                latestAppliedSaveRequestIdRef.current = requestId;
                loadedIdentityRef.current = getResponseIdentity(response);
              } else if (hasNewerLocalEdits || isOlderThanAppliedResponse) {
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
              } else {
                latestAppliedSaveRequestIdRef.current = requestId;
                onCanonicalSaveResponse(response, {
                  source: "canonical-save",
                  requestId,
                  requestSignature: signature,
                });
                loadedIdentityRef.current = getResponseIdentity(response);
              }
            }
          }
        }
      } catch (error) {
        outcome = "failed";
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
        await onPersistenceSettled({
          error: saveError,
          outcome,
          preparationContext,
          requestDraft: nextDraft,
          requestPayload: payload,
          requestSignature: signature,
          response: result,
        });
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
    clearAutosaveTimer,
    getCurrentIdentity,
    getResponseIdentity,
    getSaveErrorPatch,
    handleSaveError,
    hydrate,
    isTransientlyPaused,
    metadataRef,
    onCanonicalSaveResponse,
    onPersistenceSettled,
    onQueuedSaveError,
    onSuccessfulSaveResponse,
    persistDocument,
    preparePersistence,
    serializeDraft,
    setMetadata,
  ]);

  const {
    documentId: currentDocumentId,
    versionId: currentVersionId,
  } = getCurrentIdentity(metadata) || {};

  // Document autosave is driven only by structural mutation state. The
  // serialized signature still suppresses no-op document writes.
  useEffect(() => {
    const autosaveDecision = shouldAutosave({
      draft: draftRef.current,
      metadata: metadataRef.current,
    });
    if (
      !metadata.loadedFromBackend ||
      !currentDocumentId ||
      !currentVersionId ||
      metadataRef.current.saveState === "conflict" ||
      isTransientlyPaused?.(metadataRef.current) ||
      autosaveDecision === false
    ) {
      return undefined;
    }

    const draftSnapshot = draftRef.current;
    const signature = JSON.stringify(serializeDraft(draftSnapshot));
    if (
      signature === metadata.lastPersistedSignature &&
      autosaveDecision !== true
    ) {
      return undefined;
    }

    if (signature !== metadata.lastPersistedSignature) {
      setMetadata((prev) => (
        prev.saveState === "saving" || prev.saveState === "dirty"
          ? prev
          : { ...prev, saveState: "dirty" }
      ));
    }

    const identitySnapshot = {
      documentId: currentDocumentId,
      versionId: currentVersionId,
    };
    const timeoutId = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      persistDraftNow(draftSnapshot, identitySnapshot).catch((error) => {
        onAutosaveError?.(error, metadataRef.current);
      });
    }, AUTOSAVE_DEBOUNCE_MS);
    autosaveTimerRef.current = timeoutId;

    return () => {
      if (autosaveTimerRef.current === timeoutId) {
        autosaveTimerRef.current = null;
      }
      window.clearTimeout(timeoutId);
    };
  }, [
    currentDocumentId,
    currentVersionId,
    autosaveTrigger,
    isTransientlyPaused,
    metadata.lastPersistedSignature,
    metadata.loadedFromBackend,
    metadataRef,
    onAutosaveError,
    persistDraftNow,
    serializeDraft,
    setMetadata,
    shouldAutosave,
  ]);

  useEffect(() => clearAutosaveTimer, [clearAutosaveTimer]);

  return {
    beginHydrationTarget,
    draftRef,
    hydrate,
    metadataRef,
    persistDraftNow,
    resetHydrationIdentity,
  };
}
