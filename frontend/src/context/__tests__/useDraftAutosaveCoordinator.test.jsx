import { useCallback, useRef, useState } from "react";
import { act, renderHook } from "@testing-library/react";
import { useDraftAutosaveCoordinator } from "../useDraftAutosaveCoordinator";

function buildResponse({
  documentId = "document_a",
  versionId = "version_a",
  revision = 10,
  title = "Server title",
} = {}) {
  return {
    documentId,
    versionId,
    revision,
    updatedAt: `2026-08-20T12:${String(revision).padStart(2, "0")}:00.000Z`,
    draft: { title },
  };
}

function createMetadata() {
  return {
    documentId: null,
    versionId: null,
    loadedFromBackend: false,
    revision: null,
    saveState: "idle",
    lastPersistedSignature: null,
    lastSavedAt: null,
    lastSaveErrorCode: null,
    lastSaveErrorMessage: null,
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

async function flushMicrotasks(count = 8) {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

async function advanceAutosave(milliseconds = 700) {
  await act(async () => {
    jest.advanceTimersByTime(milliseconds);
    await flushMicrotasks();
  });
}

function useCoordinatorHarness({
  persistDocument,
  handleSaveError,
  onAutosaveError,
  onQueuedSaveError,
}) {
  const [draft, setDraft] = useState({ title: "Local only" });
  const [metadata, setMetadataState] = useState(createMetadata);
  const [structuralMutationVersion, setStructuralMutationVersion] = useState(0);
  const metadataRef = useRef(metadata);
  const structuralMutationVersionRef = useRef(0);
  const persistedStructuralMutationVersionRef = useRef(0);
  metadataRef.current = metadata;

  const setMetadata = useCallback((updater) => {
    const current = metadataRef.current;
    const next = typeof updater === "function" ? updater(current) : updater;
    metadataRef.current = next;
    setMetadataState(next);
  }, []);

  const serializeDraft = useCallback((value) => ({ title: value.title }), []);
  const getCurrentIdentity = useCallback((value) => (
    value?.documentId && value?.versionId
      ? { documentId: value.documentId, versionId: value.versionId }
      : null
  ), []);
  const getResponseIdentity = useCallback((response) => ({
    documentId: response.documentId,
    versionId: response.versionId,
  }), []);
  const onHydrate = useCallback((response) => {
    persistedStructuralMutationVersionRef.current = structuralMutationVersionRef.current;
    setDraft(response.draft);
    setMetadata({
      documentId: response.documentId,
      versionId: response.versionId,
      loadedFromBackend: true,
      revision: response.revision,
      saveState: "saved",
      lastPersistedSignature: JSON.stringify(serializeDraft(response.draft)),
      lastSavedAt: response.updatedAt,
      lastSaveErrorCode: null,
      lastSaveErrorMessage: null,
    });
  }, [serializeDraft, setMetadata]);
  const preparePersistence = useCallback(async ({ draft: currentDraft }) => ({
    draft: currentDraft,
    metadata: metadataRef.current,
    context: {
      structuralMutationVersion: structuralMutationVersionRef.current,
    },
  }), []);
  const onSuccessfulSaveResponse = useCallback((response, context) => {
    const persistedVersion = context.preparationContext.structuralMutationVersion;
    persistedStructuralMutationVersionRef.current = Math.max(
      persistedStructuralMutationVersionRef.current,
      persistedVersion
    );
    const hasNewerStructuralMutation =
      structuralMutationVersionRef.current > persistedVersion;
    if (!hasNewerStructuralMutation) {
      setDraft(response.draft);
    }
    setMetadata((previous) => ({
      ...previous,
      documentId: response.documentId,
      versionId: response.versionId,
      revision: response.revision,
      saveState: hasNewerStructuralMutation ? "dirty" : "saved",
      lastPersistedSignature: context.requestSignature,
      lastSavedAt: response.updatedAt,
      lastSaveErrorCode: null,
      lastSaveErrorMessage: null,
    }));
    return true;
  }, [setMetadata]);
  const onPersistenceSettled = useCallback(async () => {}, []);
  const shouldAutosave = useCallback(() => (
    structuralMutationVersionRef.current >
    persistedStructuralMutationVersionRef.current
  ), []);
  const isTransientlyPaused = useCallback(() => false, []);
  const getSaveErrorPatch = useCallback((error) => ({
    lastSaveErrorCode: error?.code || null,
    lastSaveErrorMessage: error?.message || null,
  }), []);
  const onCanonicalSaveResponse = useCallback(() => {}, []);

  const coordinator = useDraftAutosaveCoordinator({
    draft,
    metadata,
    metadataSourceRef: metadataRef,
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
    autosaveTrigger: structuralMutationVersion,
  });

  const mutateStructural = useCallback((title) => {
    structuralMutationVersionRef.current += 1;
    setStructuralMutationVersion(structuralMutationVersionRef.current);
    setDraft({ title });
  }, []);

  return {
    ...coordinator,
    draft,
    metadata,
    mutateStructural,
  };
}

describe("useDraftAutosaveCoordinator structural/document regressions", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test("C1/C4: a true revision conflict suspends later structural autosave", async () => {
    const conflict = Object.assign(new Error("This draft was updated elsewhere."), {
      code: "DRAFT_REVISION_CONFLICT",
      status: 409,
    });
    const persistDocument = jest.fn().mockRejectedValue(conflict);
    const handleSaveError = jest.fn().mockResolvedValue(false);
    const onAutosaveError = jest.fn();
    const { result } = renderHook(() => useCoordinatorHarness({
      persistDocument,
      handleSaveError,
      onAutosaveError,
    }));

    act(() => result.current.hydrate(buildResponse()));
    act(() => result.current.mutateStructural("Conflicting title"));
    await advanceAutosave();

    expect(persistDocument).toHaveBeenCalledTimes(1);
    expect(handleSaveError).not.toHaveBeenCalled();
    expect(result.current.metadata.saveState).toBe("conflict");
    expect(result.current.metadata.revision).toBe(10);
    expect(result.current.draft.title).toBe("Conflicting title");

    act(() => result.current.mutateStructural("Newest protected title"));
    await advanceAutosave(5000);

    expect(persistDocument).toHaveBeenCalledTimes(1);
    expect(result.current.metadata.saveState).toBe("conflict");
    expect(result.current.draft.title).toBe("Newest protected title");
    expect(onAutosaveError).toHaveBeenCalledTimes(1);
  });

  test("C3/C4: a generic rejection preserves persistence metadata and a later mutation saves", async () => {
    const genericError = Object.assign(new Error("network unavailable"), {
      code: "NETWORK_ERROR",
      status: 503,
    });
    const persistDocument = jest.fn()
      .mockRejectedValueOnce(genericError)
      .mockImplementationOnce(async ({ identity, payload }) => buildResponse({
        ...identity,
        revision: 12,
        title: payload.title,
      }));
    const handleSaveError = jest.fn().mockResolvedValue(false);
    const onAutosaveError = jest.fn();
    const { result } = renderHook(() => useCoordinatorHarness({
      persistDocument,
      handleSaveError,
      onAutosaveError,
    }));

    act(() => result.current.hydrate(buildResponse()));
    const initialSignature = result.current.metadata.lastPersistedSignature;
    act(() => result.current.mutateStructural("Locally retained failure"));
    await advanceAutosave();

    expect(persistDocument).toHaveBeenCalledTimes(1);
    expect(handleSaveError).toHaveBeenCalledTimes(1);
    expect(result.current.metadata.saveState).toBe("error");
    expect(result.current.metadata.saveState).not.toBe("conflict");
    expect(result.current.metadata.lastSaveErrorCode).toBe("NETWORK_ERROR");
    expect(result.current.metadata.revision).toBe(10);
    expect(result.current.metadata.lastPersistedSignature).toBe(initialSignature);
    expect(result.current.draft.title).toBe("Locally retained failure");

    await advanceAutosave(5000);
    expect(persistDocument).toHaveBeenCalledTimes(1);

    act(() => result.current.mutateStructural("Later valid mutation"));
    await advanceAutosave();

    expect(persistDocument).toHaveBeenCalledTimes(2);
    expect(persistDocument.mock.calls[1][0].payload).toEqual({
      title: "Later valid mutation",
    });
    expect(result.current.metadata.saveState).toBe("saved");
    expect(result.current.metadata.revision).toBe(12);
    expect(result.current.metadata.lastPersistedSignature).toBe(
      JSON.stringify({ title: "Later valid mutation" })
    );
    expect(onAutosaveError).toHaveBeenCalledTimes(1);
  });

  test("C6: same-document hydration cannot overwrite an in-flight structural edit", async () => {
    const save = createDeferred();
    const persistDocument = jest.fn().mockReturnValue(save.promise);
    const { result } = renderHook(() => useCoordinatorHarness({
      persistDocument,
      handleSaveError: jest.fn().mockResolvedValue(false),
      onAutosaveError: jest.fn(),
    }));

    act(() => result.current.hydrate(buildResponse()));
    act(() => result.current.mutateStructural("Newer local title"));
    await advanceAutosave();
    expect(result.current.metadata.saveState).toBe("saving");

    let accepted;
    act(() => {
      accepted = result.current.hydrate(buildResponse({
        revision: 11,
        title: "Late stale server title",
      }));
    });
    expect(accepted).toBe(false);
    expect(result.current.draft.title).toBe("Newer local title");
    expect(result.current.metadata.revision).toBe(10);

    await act(async () => {
      save.resolve(buildResponse({ revision: 12, title: "Newer local title" }));
      await save.promise;
      await flushMicrotasks();
    });
    expect(result.current.metadata.revision).toBe(12);
    expect(result.current.draft.title).toBe("Newer local title");

    act(() => result.current.beginHydrationTarget({
      documentId: "document_b",
      versionId: null,
    }));
    act(() => {
      accepted = result.current.hydrate(buildResponse({
        documentId: "document_b",
        versionId: "version_b",
        revision: 20,
        title: "Legitimate other document",
      }));
    });
    expect(accepted).toBe(true);
    expect(result.current.draft.title).toBe("Legitimate other document");
    expect(result.current.metadata).toEqual(expect.objectContaining({
      documentId: "document_b",
      versionId: "version_b",
      revision: 20,
      saveState: "saved",
    }));
  });

  test("C7: rejected save A chains the coalesced newest structural save B", async () => {
    const saveA = createDeferred();
    const saveB = createDeferred();
    const persistDocument = jest.fn()
      .mockReturnValueOnce(saveA.promise)
      .mockReturnValueOnce(saveB.promise);
    const onQueuedSaveError = jest.fn();
    const { result } = renderHook(() => useCoordinatorHarness({
      persistDocument,
      handleSaveError: jest.fn().mockResolvedValue(false),
      onAutosaveError: jest.fn(),
      onQueuedSaveError,
    }));

    act(() => result.current.hydrate(buildResponse()));
    act(() => result.current.mutateStructural("Structural A"));
    let firstChain;
    act(() => {
      firstChain = result.current.persistDraftNow();
    });
    await act(async () => flushMicrotasks());
    expect(persistDocument).toHaveBeenCalledTimes(1);
    expect(persistDocument.mock.calls[0][0].payload).toEqual({ title: "Structural A" });

    act(() => result.current.mutateStructural("Structural B"));
    let joinedChain;
    let joinedSettled = false;
    act(() => {
      joinedChain = result.current.persistDraftNow().then((value) => {
        joinedSettled = true;
        return value;
      });
    });

    await act(async () => {
      saveA.reject(new Error("first structural save failed"));
      await flushMicrotasks();
    });

    expect(persistDocument).toHaveBeenCalledTimes(2);
    expect(persistDocument.mock.calls[1][0].payload).toEqual({ title: "Structural B" });
    expect(result.current.draft.title).toBe("Structural B");
    expect(joinedSettled).toBe(false);

    await act(async () => {
      saveB.resolve(buildResponse({ revision: 12, title: "Structural B" }));
      await Promise.all([firstChain, joinedChain]);
    });

    expect(joinedSettled).toBe(true);
    expect(result.current.draft.title).toBe("Structural B");
    expect(result.current.metadata.revision).toBe(12);
    expect(result.current.metadata.saveState).toBe("saved");
    expect(onQueuedSaveError).not.toHaveBeenCalled();

    await advanceAutosave(5000);
    expect(persistDocument).toHaveBeenCalledTimes(2);
  });
});
