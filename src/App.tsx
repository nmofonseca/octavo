import { useCallback, useEffect, useState } from "react";
import { Library } from "./components/Library";
import { Reader } from "./components/Reader";
import { docIdFromMeta, loadLibrary, saveLibrary, touchOpened } from "./lib/storage";
import { scheduleWindowIconApply } from "./lib/windowIcon";
import type { LibraryDoc } from "./types";
import "./styles.css";

const SAMPLE: LibraryDoc = {
  id: "sample::octavo-welcome",
  title: "Welcome to Octavo",
  source: "sample",
  url: "/samples/octavo-welcome.pdf",
  addedAt: Date.now(),
  pageCount: 3,
};

function loadInitialDocs(): LibraryDoc[] {
  const stored = loadLibrary().filter((d) => d.source === "sample" || d.url);
  if (stored.length === 0) {
    const seed = [SAMPLE];
    saveLibrary(seed);
    return seed;
  }
  const hasSample = stored.some((d) => d.id === SAMPLE.id);
  const next = hasSample ? stored : [SAMPLE, ...stored];
  if (!hasSample) saveLibrary(next);
  return next;
}

export default function App() {
  const [docs, setDocs] = useState<LibraryDoc[]>(loadInitialDocs);
  const [active, setActive] = useState<LibraryDoc | null>(null);

  useEffect(() => scheduleWindowIconApply(), []);

  const openDoc = useCallback((doc: LibraryDoc) => {
    if (doc.source === "file" && !doc.url) return;
    setDocs((prev) => {
      const next = touchOpened(prev, doc.id);
      saveLibrary(next);
      return next;
    });
    setActive(doc);
  }, []);

  const openSample = useCallback(() => {
    setDocs((prev) => {
      const exists = prev.find((d) => d.id === SAMPLE.id);
      let next = exists ? prev : [SAMPLE, ...prev];
      next = touchOpened(next, SAMPLE.id);
      saveLibrary(next);
      return next;
    });
    setActive(SAMPLE);
  }, []);

  const openFile = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    const doc: LibraryDoc = {
      id: docIdFromMeta(file.name, file.size),
      title: file.name.replace(/\.pdf$/i, ""),
      source: "file",
      url,
      addedAt: Date.now(),
      lastOpenedAt: Date.now(),
    };
    setDocs((prev) => {
      const next = touchOpened(
        [doc, ...prev.filter((d) => d.id !== doc.id)],
        doc.id,
      );
      saveLibrary(next);
      return next;
    });
    setActive(doc);
  }, []);

  // Dev/QA: ?open=/samples/foo.pdf auto-opens (browser + packaged repros).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const openPath = params.get("open");
    if (!openPath || !openPath.startsWith("/") || openPath.includes("://")) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(openPath);
        if (!res.ok || cancelled) return;
        const blob = await res.blob();
        const name =
          openPath.split("/").pop()?.replace(/[^\w.-]+/g, "_") || "document.pdf";
        const file = new File([blob], name.endsWith(".pdf") ? name : `${name}.pdf`, {
          type: "application/pdf",
        });
        if (!cancelled) openFile(file);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [openFile]);

  const removeDoc = useCallback((id: string) => {
    setDocs((prev) => {
      const next = prev.filter((d) => d.id !== id);
      saveLibrary(next);
      return next;
    });
  }, []);

  const onMeta = useCallback(
    (pageCount: number, lastPage: number) => {
      if (!active) return;
      setDocs((prev) => {
        const next = prev.map((d) =>
          d.id === active.id ? { ...d, pageCount, lastPage } : d,
        );
        saveLibrary(next);
        return next;
      });
    },
    [active],
  );

  return (
    <div className="app-shell">
      <div className="atmosphere" aria-hidden />
      {active ? (
        <Reader doc={active} onBack={() => setActive(null)} onMeta={onMeta} />
      ) : (
        <Library
          docs={docs}
          onOpen={openDoc}
          onOpenFile={openFile}
          onOpenSample={openSample}
          onRemove={removeDoc}
        />
      )}
    </div>
  );
}
