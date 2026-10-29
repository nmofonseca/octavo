import type { OutlineItem } from "../types";

type Thumb = { page: number; src: string };

type Props = {
  panel: "thumbs" | "outline" | null;
  page: number;
  pageCount: number;
  thumbs: Thumb[];
  outline: OutlineItem[];
  onSelectPage: (page: number) => void;
  onClose: () => void;
};

export function ReaderSidebar({
  panel,
  page,
  pageCount,
  thumbs,
  outline,
  onSelectPage,
  onClose,
}: Props) {
  if (!panel) return null;

  return (
    <aside className="reader-sidebar" aria-label={panel === "thumbs" ? "Thumbnails" : "Outline"}>
      <div className="sidebar-head">
        <span>{panel === "thumbs" ? "Pages" : "Outline"}</span>
        <button type="button" className="icon-btn" aria-label="Close panel" onClick={onClose}>
          ×
        </button>
      </div>

      {panel === "thumbs" && (
        <div className="thumb-list">
          {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => {
            const thumb = thumbs.find((t) => t.page === p);
            return (
              <button
                key={p}
                type="button"
                className={`thumb-tile ${p === page ? "active" : ""}`}
                onClick={() => onSelectPage(p)}
              >
                <div className="thumb-frame">
                  {thumb ? (
                    <img src={thumb.src} alt={`Page ${p}`} />
                  ) : (
                    <div className="thumb-skel" />
                  )}
                </div>
                <span>{p}</span>
              </button>
            );
          })}
        </div>
      )}

      {panel === "outline" && (
        <div className="outline-list">
          {outline.length === 0 ? (
            <p className="sidebar-empty">No bookmarks in this PDF.</p>
          ) : (
            <OutlineTree items={outline} page={page} onSelectPage={onSelectPage} depth={0} />
          )}
        </div>
      )}
    </aside>
  );
}

function OutlineTree({
  items,
  page,
  onSelectPage,
  depth,
}: {
  items: OutlineItem[];
  page: number;
  onSelectPage: (page: number) => void;
  depth: number;
}) {
  return (
    <ul className="outline-tree" style={{ ["--depth" as string]: depth }}>
      {items.map((item, i) => (
        <li key={`${item.title}-${i}`}>
          <button
            type="button"
            className={`outline-item ${item.page === page ? "active" : ""}`}
            disabled={item.page == null}
            onClick={() => item.page != null && onSelectPage(item.page)}
            style={{ paddingLeft: `${0.75 + depth * 0.85}rem` }}
          >
            <span className="outline-title">{item.title}</span>
            {item.page != null && <span className="outline-page">{item.page}</span>}
          </button>
          {item.items.length > 0 && (
            <OutlineTree
              items={item.items}
              page={page}
              onSelectPage={onSelectPage}
              depth={depth + 1}
            />
          )}
        </li>
      ))}
    </ul>
  );
}
