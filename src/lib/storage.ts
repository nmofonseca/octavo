import type { Annotation, DocStore, LibraryDoc } from "../types";

const LIBRARY_KEY = "octavo.library.v1";
const DOC_PREFIX = "octavo.doc.v1:";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function loadLibrary(): LibraryDoc[] {
  return readJson<LibraryDoc[]>(LIBRARY_KEY, []);
}

export function saveLibrary(docs: LibraryDoc[]) {
  // Persist sample docs fully; file blob URLs are session-only so strip dead ones on reload
  const persistable = docs.map((d) =>
    d.source === "file" && d.url.startsWith("blob:")
      ? { ...d, url: "" }
      : d,
  );
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(persistable));
}

export function loadDocStore(docId: string): DocStore {
  return readJson<DocStore>(DOC_PREFIX + docId, {
    annotations: [],
    lastPage: 1,
    zoom: 1.1,
    rotation: 0,
    viewMode: "continuous",
  });
}

export function saveDocStore(docId: string, store: DocStore) {
  localStorage.setItem(DOC_PREFIX + docId, JSON.stringify(store));
}

export function upsertAnnotations(
  docId: string,
  annotations: Annotation[],
  extras?: Partial<Omit<DocStore, "annotations">>,
) {
  const prev = loadDocStore(docId);
  saveDocStore(docId, {
    annotations,
    lastPage: extras?.lastPage ?? prev.lastPage,
    zoom: extras?.zoom ?? prev.zoom,
    rotation: extras?.rotation ?? prev.rotation ?? 0,
    viewMode: extras?.viewMode ?? prev.viewMode ?? "continuous",
  });
}

export function docIdFromMeta(title: string, bytes?: number) {
  return `${title}::${bytes ?? 0}`;
}

export function touchOpened(docs: LibraryDoc[], id: string): LibraryDoc[] {
  const now = Date.now();
  return docs
    .map((d) => (d.id === id ? { ...d, lastOpenedAt: now } : d))
    .sort((a, b) => (b.lastOpenedAt ?? b.addedAt) - (a.lastOpenedAt ?? a.addedAt));
}
