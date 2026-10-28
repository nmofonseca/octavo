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
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(docs));
}

export function loadDocStore(docId: string): DocStore {
  return readJson<DocStore>(DOC_PREFIX + docId, {
    annotations: [],
    lastPage: 1,
    zoom: 1.1,
  });
}

export function saveDocStore(docId: string, store: DocStore) {
  localStorage.setItem(DOC_PREFIX + docId, JSON.stringify(store));
}

export function upsertAnnotations(
  docId: string,
  annotations: Annotation[],
  extras?: Partial<Pick<DocStore, "lastPage" | "zoom">>,
) {
  const prev = loadDocStore(docId);
  saveDocStore(docId, {
    annotations,
    lastPage: extras?.lastPage ?? prev.lastPage,
    zoom: extras?.zoom ?? prev.zoom,
  });
}

export function docIdFromMeta(title: string, bytes?: number) {
  return `${title}::${bytes ?? 0}`;
}
