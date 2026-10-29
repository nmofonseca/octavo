import { useMemo, useRef } from "react";
import type { LibraryDoc } from "../types";
import { APP_VERSION } from "../version";

type Props = {
  docs: LibraryDoc[];
  onOpen: (doc: LibraryDoc) => void;
  onOpenFile: (file: File) => void;
  onOpenSample: () => void;
  onRemove?: (id: string) => void;
};

function formatWhen(ts?: number) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return `Today · ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  }
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

export function Library({ docs, onOpen, onOpenFile, onOpenSample, onRemove }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  const recent = useMemo(() => {
    return [...docs].sort(
      (a, b) => (b.lastOpenedAt ?? b.addedAt) - (a.lastOpenedAt ?? a.addedAt),
    );
  }, [docs]);

  const lastOpened = recent.find((d) => d.lastOpenedAt);

  return (
    <div className="library">
      <section className="library-hero" aria-label="Octavo">
        <div className="brand-mark">
          <img src="/octavo.svg" alt="" width={48} height={48} />
        </div>
        <h1 className="brand">Octavo</h1>
        <p className="hero-line">
          A personal desktop reader — search, mark up, and keep your library close.
        </p>
        <p className="app-version" aria-label={`Version ${APP_VERSION}`}>
          v{APP_VERSION}
        </p>
        <div className="hero-actions">
          <button type="button" className="btn btn-primary" onClick={onOpenSample}>
            Open sample PDF
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => fileRef.current?.click()}
          >
            Open a file…
          </button>
          {lastOpened && (
            <button type="button" className="btn btn-ember" onClick={() => onOpen(lastOpened)}>
              Resume “{lastOpened.title}”
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            multiple
            onChange={(e) => {
              const files = e.target.files;
              if (!files) return;
              Array.from(files).forEach((file) => onOpenFile(file));
              e.target.value = "";
            }}
          />
        </div>
      </section>

      <section className="library-rail" aria-label="Recent library">
        <div className="rail-head">
          <div className="rail-label">Recent</div>
          <button
            type="button"
            className="btn btn-ghost compact"
            onClick={() => fileRef.current?.click()}
          >
            + Add PDF
          </button>
        </div>
        <div className="doc-row">
          {recent.map((doc) => (
            <div key={doc.id} className="doc-tile-wrap">
              <button type="button" className="doc-tile" onClick={() => onOpen(doc)}>
                <div className="doc-spine" aria-hidden />
                <h3>{doc.title}</h3>
                <p>
                  {doc.pageCount ? `${doc.pageCount} pages` : "PDF"}
                  {doc.lastPage ? ` · p.${doc.lastPage}` : ""}
                </p>
                <div className="meta">
                  <span>{doc.source === "sample" ? "Sample" : "Local"}</span>
                  <span>{formatWhen(doc.lastOpenedAt ?? doc.addedAt)}</span>
                </div>
              </button>
              {doc.source === "file" && onRemove && (
                <button
                  type="button"
                  className="doc-remove"
                  aria-label={`Remove ${doc.title}`}
                  onClick={() => onRemove(doc.id)}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {recent.length === 0 && (
            <button type="button" className="doc-tile" onClick={onOpenSample}>
              <div className="doc-spine" aria-hidden />
              <h3>Welcome to Octavo</h3>
              <p>Sample pages ready for search and annotation.</p>
              <div className="meta">
                <span>Sample</span>
              </div>
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
