import { useCallback, useEffect, useState } from "react";
import { Library } from "./components/Library";
import { Reader } from "./components/Reader";
import { docIdFromMeta, loadLibrary, saveLibrary } from "./lib/storage";
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

export default function App() {
  const [docs, setDocs] = useState<LibraryDoc[]>([]);
  const [active, setActive] = useState<LibraryDoc | null>(null);

  useEffect(() => {
    const stored = loadLibrary();
    if (stored.length === 0) {
      const seed = [SAMPLE];
      saveLibrary(seed);
      setDocs(seed);
    } else {
      // Ensure sample stays available
      const hasSample = stored.some((d) => d.id === SAMPLE.id);
      const next = hasSample ? stored : [SAMPLE, ...stored];
      if (!hasSample) saveLibrary(next);
      setDocs(next);
    }
  }, []);

  const openDoc = useCallback((doc: LibraryDoc) => {
    setActive(doc);
  }, []);

  const openSample = useCallback(() => {
    setDocs((prev) => {
      const exists = prev.find((d) => d.id === SAMPLE.id);
      if (exists) return prev;
      const next = [SAMPLE, ...prev];
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
    };
    setDocs((prev) => {
      const next = [doc, ...prev.filter((d) => d.id !== doc.id)];
      saveLibrary(
        next.map((d) =>
          // Don't persist blob URLs across reloads — only metadata for files is session-local
          d.source === "file" ? { ...d, url: d.id === doc.id ? url : d.url } : d,
        ),
      );
      return next;
    });
    setActive(doc);
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
        />
      )}
    </div>
  );
}
