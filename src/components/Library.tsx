import { useRef } from "react";
import type { LibraryDoc } from "../types";

type Props = {
  docs: LibraryDoc[];
  onOpen: (doc: LibraryDoc) => void;
  onOpenFile: (file: File) => void;
  onOpenSample: () => void;
};

export function Library({ docs, onOpen, onOpenFile, onOpenSample }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="library">
      <section className="library-hero" aria-label="Octavo">
        <div className="brand-mark">
          <img src="/octavo.svg" alt="" width={42} height={42} />
        </div>
        <h1 className="brand">Octavo</h1>
        <p className="hero-line">
          A quiet desktop reader for marked-up pages — highlights, ink, and sticky notes that stay
          yours.
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
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onOpenFile(file);
              e.target.value = "";
            }}
          />
        </div>
      </section>

      <section className="library-rail" aria-label="Library">
        <div className="rail-label">Library</div>
        <div className="doc-row">
          {docs.map((doc) => (
            <button
              key={doc.id}
              type="button"
              className="doc-tile"
              onClick={() => onOpen(doc)}
            >
              <h3>{doc.title}</h3>
              <p>
                {doc.pageCount ? `${doc.pageCount} pages` : "PDF"}
                {doc.lastPage ? ` · resumed p.${doc.lastPage}` : ""}
              </p>
              <div className="meta">{doc.source === "sample" ? "Sample" : "Local file"}</div>
            </button>
          ))}
          {docs.length === 0 && (
            <button type="button" className="doc-tile" onClick={onOpenSample}>
              <h3>Welcome to Octavo</h3>
              <p>Three sample pages ready for annotation.</p>
              <div className="meta">Sample</div>
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
