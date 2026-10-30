import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PDFDocumentProxy, PDFWorker } from "pdfjs-dist";
import {
  canRedo,
  canUndo,
  createHistory,
  pushHistory,
  redoHistory,
  replacePresent,
  undoHistory,
  type HistoryState,
} from "../lib/history";
import {
  destroyThumbPdf,
  getOutlineTree,
  openPdf,
  openPdfForThumbs,
  renderThumbnailReliable,
  searchDocument,
} from "../lib/pdf";
import { loadDocStore, upsertAnnotations } from "../lib/storage";
import {
  ZOOM_PRESETS,
  nextZoomFromWheelDelta,
  zoomIn,
  zoomOut,
} from "../lib/zoom";
import { OctavoLogo } from "./OctavoLogo";
import type {
  Annotation,
  FitMode,
  LibraryDoc,
  OutlineItem,
  Rotation,
  SearchHit,
  Tool,
  ViewMode,
} from "../types";
import { PageView } from "./PageView";
import { ReaderSidebar } from "./ReaderSidebar";

type Props = {
  doc: LibraryDoc;
  onBack: () => void;
  onMeta: (pageCount: number, lastPage: number) => void;
};

export function Reader({ doc, onBack, onMeta }: Props) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(1.15);
  const [fit, setFit] = useState<FitMode>("custom");
  const [rotation, setRotation] = useState<Rotation>(0);
  const [viewMode, setViewMode] = useState<ViewMode>("continuous");
  const [tool, setTool] = useState<Tool>("pan");
  const [annoHistory, setAnnoHistory] = useState<HistoryState<Annotation[]>>(
    () => createHistory<Annotation[]>([]),
  );
  const annotations = annoHistory.present;
  const [toast, setToast] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [panel, setPanel] = useState<"thumbs" | "outline" | null>("thumbs");
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [thumbs, setThumbs] = useState<{ page: number; src: string }[]>([]);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [hitIndex, setHitIndex] = useState(0);
  const [searching, setSearching] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const thumbAbortRef = useRef<AbortController | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1800);
  }, []);

  // Load doc
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setThumbs([]);
      setOutline([]);
      setSearchHits([]);
      setSearchQuery("");
      try {
        const store = loadDocStore(doc.id);
        if (!cancelled) {
          setAnnoHistory(createHistory(store.annotations));
          setPage(store.lastPage || 1);
          setZoom(store.zoom || 1.15);
          setRotation((store.rotation as Rotation) || 0);
          setViewMode(store.viewMode || "continuous");
        }
        const proxy = await openPdf(doc.url);
        if (cancelled) return;
        setPdf(proxy);
        setPageCount(proxy.numPages);
        onMeta(proxy.numPages, store.lastPage || 1);
        const tree = await getOutlineTree(proxy);
        if (!cancelled) setOutline(tree);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to open PDF");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc.id, doc.url, onMeta]);

  // Persist
  useEffect(() => {
    if (!pdf) return;
    upsertAnnotations(doc.id, annotations, {
      lastPage: page,
      zoom,
      rotation,
      viewMode,
    });
  }, [annotations, doc.id, page, zoom, rotation, viewMode, pdf]);

  // Thumbnails — dedicated PDF + dedicated worker (destroy cannot kill the
  // viewer worker). Deferred so visible PageViews claim the first paint slots;
  // sequential high-DPI PNG with blank/cancel retries; abortable.
  useEffect(() => {
    if (!pdf || pageCount < 1) return;
    thumbAbortRef.current?.abort();
    const ac = new AbortController();
    thumbAbortRef.current = ac;
    let thumbPdf: PDFDocumentProxy | null = null;
    let thumbWorker: PDFWorker | null = null;
    let usedViewerPdf = false;

    (async () => {
      // Yield so the first main PageView paints claim the render queue before
      // thumb operator lists start (critical on WebKitGTK / AppImage).
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      await new Promise<void>((r) => window.setTimeout(r, 120));
      if (ac.signal.aborted) return;

      try {
        const opened = await openPdfForThumbs(doc.url);
        thumbPdf = opened.pdf;
        thumbWorker = opened.worker;
      } catch {
        // Fall back to the viewer proxy if a second open fails
        thumbPdf = pdf;
        usedViewerPdf = true;
      }
      if (ac.signal.aborted) {
        if (!usedViewerPdf) await destroyThumbPdf(thumbPdf, thumbWorker);
        return;
      }

      const next: { page: number; src: string }[] = [];
      // Sidebar CSS width ~148px; render denser for sharpness (DPR applied inside)
      const targetWidth = 160;
      for (let p = 1; p <= pageCount; p++) {
        if (ac.signal.aborted) break;
        try {
          const src = await renderThumbnailReliable(
            thumbPdf,
            p,
            targetWidth,
            rotation,
            ac.signal,
          );
          if (ac.signal.aborted || !src) continue;
          next.push({ page: p, src });
          // Publish after every page so first thumbs aren't stuck blank/skeleton
          setThumbs([...next]);
          // Yield to the main thread between thumbs so PageView rAF paints run
          await new Promise<void>((r) => requestAnimationFrame(() => r()));
        } catch (e) {
          if ((e as Error).name === "AbortError" || ac.signal.aborted) break;
          /* skip broken page after retries; keep skeleton */
        }
      }

      if (!usedViewerPdf) await destroyThumbPdf(thumbPdf, thumbWorker);
    })();

    return () => {
      ac.abort();
    };
  }, [pdf, pageCount, rotation, doc.url]);

  const applyFit = useCallback(
    async (mode: FitMode) => {
      if (!pdf || !stageRef.current) return;
      if (mode === "custom") {
        setFit("custom");
        return;
      }
      const pg = await pdf.getPage(page);
      const base = pg.getViewport({ scale: 1, rotation });
      const stage = stageRef.current;
      const pad = 48;
      const availW = Math.max(120, stage.clientWidth - pad);
      const availH = Math.max(120, stage.clientHeight - pad);
      let next =
        mode === "width"
          ? availW / base.width
          : Math.min(availW / base.width, availH / base.height);
      next = Math.min(3, Math.max(0.4, +next.toFixed(3)));
      setZoom(next);
      setFit(mode);
    },
    [pdf, page, rotation],
  );

  // Re-fit on resize when fit mode active
  useEffect(() => {
    if (fit === "custom") return;
    const onResize = () => {
      void applyFit(fit);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fit, applyFit]);

  const goToPage = useCallback(
    (p: number) => {
      const next = Math.min(pageCount, Math.max(1, p));
      setPage(next);
      if (viewMode === "continuous") {
        requestAnimationFrame(() => {
          document
            .getElementById(`octavo-page-${next}`)
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      } else if (stageRef.current) {
        stageRef.current.scrollTop = 0;
      }
    },
    [pageCount, viewMode],
  );

  const runSearch = useCallback(
    async (q: string) => {
      if (!pdf) return;
      searchAbortRef.current?.abort();
      const ac = new AbortController();
      searchAbortRef.current = ac;
      const trimmed = q.trim();
      if (!trimmed) {
        setSearchHits([]);
        setHitIndex(0);
        setSearching(false);
        return;
      }
      setSearching(true);
      try {
        const hits = await searchDocument(pdf, trimmed, ac.signal);
        if (ac.signal.aborted) return;
        setSearchHits(hits);
        setHitIndex(0);
        if (hits[0]) goToPage(hits[0].page);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setSearchHits([]);
      } finally {
        if (!ac.signal.aborted) setSearching(false);
      }
    },
    [pdf, goToPage],
  );

  // Debounced search
  useEffect(() => {
    if (!searchOpen) return;
    const t = window.setTimeout(() => void runSearch(searchQuery), 220);
    return () => window.clearTimeout(t);
  }, [searchQuery, searchOpen, runSearch]);

  const jumpHit = useCallback(
    (dir: 1 | -1) => {
      if (searchHits.length === 0) return;
      const next = (hitIndex + dir + searchHits.length) % searchHits.length;
      setHitIndex(next);
      goToPage(searchHits[next].page);
    },
    [searchHits, hitIndex, goToPage],
  );

  const rotate = (dir: 1 | -1) => {
    setRotation((r) => ((((r + dir * 90) % 360) + 360) % 360) as Rotation);
    setFit((f) => (f === "custom" ? f : f));
  };

  const printDoc = () => {
    // Prefer printing the current page canvas(es)
    window.print();
  };

  const pagesToRender = useMemo(() => {
    if (!pageCount) return [] as number[];
    if (viewMode === "single") return [page];
    // Continuous: keep a wider window so scroll/zoom remounts less often.
    // Remounts on WebKit were a common path to blank main canvases.
    const start = Math.max(1, page - 3);
    const end = Math.min(pageCount, page + 4);
    // Always include 1..pageCount when modest
    if (pageCount <= 16) {
      return Array.from({ length: pageCount }, (_, i) => i + 1);
    }
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }, [viewMode, page, pageCount]);

  // Observe which page is in view (continuous)
  useEffect(() => {
    if (viewMode !== "continuous" || !stageRef.current) return;
    const root = stageRef.current;
    const nodes = root.querySelectorAll<HTMLElement>("[data-page]");
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        const top = visible[0]?.target.getAttribute("data-page");
        if (top) {
          const n = Number(top);
          if (n && n !== page) setPage(n);
        }
      },
      { root, threshold: [0.35, 0.55, 0.75] },
    );
    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [viewMode, pagesToRender, page]);

  const undo = useCallback(() => {
    setAnnoHistory((h) => {
      if (!canUndo(h)) return h;
      queueMicrotask(() => showToast("Undo"));
      return undoHistory(h);
    });
  }, [showToast]);

  const redo = useCallback(() => {
    setAnnoHistory((h) => {
      if (!canRedo(h)) return h;
      queueMicrotask(() => showToast("Redo"));
      return redoHistory(h);
    });
  }, [showToast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField =
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLInputElement;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (mod && key === "z" && !e.shiftKey) {
        e.preventDefault();
        if (!inField) undo();
        return;
      }
      if (mod && (key === "y" || (key === "z" && e.shiftKey))) {
        e.preventDefault();
        if (!inField) redo();
        return;
      }

      if (mod && key === "f") {
        e.preventDefault();
        setSearchOpen(true);
        requestAnimationFrame(() => searchInputRef.current?.focus());
        return;
      }
      if (mod && key === "p") {
        e.preventDefault();
        printDoc();
        return;
      }

      if (inField) {
        if (e.key === "Escape") {
          (e.target as HTMLElement).blur();
          if (searchOpen) setSearchOpen(false);
        }
        if (searchOpen && e.key === "Enter") {
          e.preventDefault();
          jumpHit(e.shiftKey ? -1 : 1);
        }
        return;
      }

      if (e.key === "Escape") {
        if (searchOpen) {
          setSearchOpen(false);
          return;
        }
        onBack();
      }
      if (e.key === "ArrowRight" || e.key === "j") goToPage(page + 1);
      if (e.key === "ArrowLeft" || e.key === "k") goToPage(page - 1);
      if (e.key === "=" || e.key === "+") {
        setFit("custom");
        setZoom(zoomIn);
      }
      if (e.key === "-" || e.key === "_") {
        setFit("custom");
        setZoom(zoomOut);
      }
      if (e.key === "1") setTool("pan");
      if (e.key === "2") setTool("highlight");
      if (e.key === "3") setTool("ink");
      if (e.key === "4") setTool("note");
      if (e.key === "r") rotate(1);
      if (e.key === "R") rotate(-1);
      if (e.key === "f") void applyFit("width");
      if (e.key === "F") void applyFit("page");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page, pageCount, onBack, goToPage, searchOpen, jumpHit, applyFit, undo, redo]);

  // Ctrl/Meta + wheel zooms on the stage; plain wheel still scrolls.
  // Non-passive so preventDefault can stop browser/page zoom/scroll.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setFit("custom");
      setZoom((z) => nextZoomFromWheelDelta(z, e.deltaY));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const addAnno = (a: Annotation) => {
    setAnnoHistory((h) => pushHistory(h, [...h.present, a]));
    if (a.type === "note") setTool("pan");
  };

  const updateNote = (id: string, text: string) => {
    // Live typing should not flood the undo stack
    setAnnoHistory((h) =>
      replacePresent(
        h,
        h.present.map((a) =>
          a.id === id && a.type === "note" ? { ...a, text } : a,
        ),
      ),
    );
  };

  const removeAnno = (id: string) => {
    setAnnoHistory((h) => pushHistory(h, h.present.filter((a) => a.id !== id)));
    showToast("Removed");
  };

  const clearPage = () => {
    setAnnoHistory((h) =>
      pushHistory(
        h,
        h.present.filter((a) => a.page !== page),
      ),
    );
    showToast("Cleared page marks");
  };

  return (
    <div className="reader">
      <header className="topbar">
        <button
          type="button"
          className="btn btn-ghost compact"
          onClick={onBack}
        >
          ← Library
        </button>
        <div className="brand-mini">
          <OctavoLogo size={22} />
          Octavo
        </div>
        <div className="doc-title">{doc.title}</div>
        <div className="spacer" />

        <div className="tool-group" role="toolbar" aria-label="Panels">
          <ToolBtn
            id="thumbs"
            label="Thumbnails"
            active={panel === "thumbs"}
            onClick={() => setPanel((p) => (p === "thumbs" ? null : "thumbs"))}
          >
            ▦
          </ToolBtn>
          <ToolBtn
            id="outline"
            label="Outline"
            active={panel === "outline"}
            onClick={() => setPanel((p) => (p === "outline" ? null : "outline"))}
          >
            ≡
          </ToolBtn>
          <ToolBtn
            id="search"
            label="Find (Ctrl/Cmd+F)"
            active={searchOpen}
            onClick={() => {
              setSearchOpen((v) => !v);
              requestAnimationFrame(() => searchInputRef.current?.focus());
            }}
          >
            ⌕
          </ToolBtn>
        </div>

        <div className="tool-group" role="toolbar" aria-label="Annotation tools">
          <ToolBtn id="pan" label="Pan" active={tool === "pan"} onClick={() => setTool("pan")}>
            ✥
          </ToolBtn>
          <ToolBtn
            id="highlight"
            label="Highlight"
            active={tool === "highlight"}
            onClick={() => setTool("highlight")}
          >
            ▮
          </ToolBtn>
          <ToolBtn id="ink" label="Ink" active={tool === "ink"} onClick={() => setTool("ink")}>
            ✎
          </ToolBtn>
          <ToolBtn
            id="note"
            label="Sticky note"
            active={tool === "note"}
            onClick={() => setTool("note")}
          >
            ▤
          </ToolBtn>
        </div>

        <div className="tool-group" role="toolbar" aria-label="History">
          <ToolBtn
            id="undo"
            label="Undo (Ctrl/Cmd+Z)"
            active={false}
            disabled={!canUndo(annoHistory)}
            onClick={undo}
          >
            ↶
          </ToolBtn>
          <ToolBtn
            id="redo"
            label="Redo (Ctrl/Cmd+Y)"
            active={false}
            disabled={!canRedo(annoHistory)}
            onClick={redo}
          >
            ↷
          </ToolBtn>
        </div>

        <div className="tool-group" role="toolbar" aria-label="View">
          <ToolBtn id="rot-ccw" label="Rotate left" active={false} onClick={() => rotate(-1)}>
            ⟲
          </ToolBtn>
          <ToolBtn id="rot-cw" label="Rotate right" active={false} onClick={() => rotate(1)}>
            ⟳
          </ToolBtn>
          <ToolBtn
            id="fit-w"
            label="Fit width"
            active={fit === "width"}
            onClick={() => void applyFit("width")}
          >
            ↔
          </ToolBtn>
          <ToolBtn
            id="fit-p"
            label="Fit page"
            active={fit === "page"}
            onClick={() => void applyFit("page")}
          >
            ▢
          </ToolBtn>
          <ToolBtn
            id="mode"
            label={viewMode === "continuous" ? "Single page" : "Continuous scroll"}
            active={false}
            onClick={() =>
              setViewMode((m) => (m === "continuous" ? "single" : "continuous"))
            }
          >
            {viewMode === "continuous" ? "☰" : "▭"}
          </ToolBtn>
          <ToolBtn id="print" label="Print" active={false} onClick={printDoc}>
            ⎙
          </ToolBtn>
        </div>

        <label className="chip zoom-chip">
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => {
              setFit("custom");
              setZoom(zoomOut);
            }}
          >
            −
          </button>
          <select
            aria-label="Zoom preset"
            value={
              ZOOM_PRESETS.includes(+zoom.toFixed(2))
                ? String(+zoom.toFixed(2))
                : "custom"
            }
            onChange={(e) => {
              const v = e.target.value;
              if (v === "custom") return;
              setFit("custom");
              setZoom(Number(v));
            }}
          >
            {!ZOOM_PRESETS.includes(+zoom.toFixed(2)) && (
              <option value="custom">{Math.round(zoom * 100)}%</option>
            )}
            {ZOOM_PRESETS.map((z) => (
              <option key={z} value={z}>
                {Math.round(z * 100)}%
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => {
              setFit("custom");
              setZoom(zoomIn);
            }}
          >
            +
          </button>
        </label>

        <div className="chip">
          <button
            type="button"
            aria-label="Previous page"
            disabled={pageCount < 1 || page <= 1}
            onClick={() => goToPage(page - 1)}
          >
            ‹
          </button>
          <span>
            {pageCount < 1 ? "…" : `${page} / ${pageCount}`}
          </span>
          <button
            type="button"
            aria-label="Next page"
            disabled={pageCount < 1 || page >= pageCount}
            onClick={() => goToPage(page + 1)}
          >
            ›
          </button>
        </div>

        <button type="button" className="btn btn-ghost compact" onClick={clearPage}>
          Clear page
        </button>
      </header>

      {searchOpen && (
        <div className="find-bar" role="search">
          <span className="find-label">Find</span>
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search in document…"
            autoFocus
          />
          <span className="find-count">
            {searching
              ? "Searching…"
              : searchQuery.trim()
                ? searchHits.length
                  ? `${hitIndex + 1} / ${searchHits.length}`
                  : "No matches"
                : "Type to search"}
          </span>
          <button
            type="button"
            className="icon-btn"
            aria-label="Previous match"
            disabled={!searchHits.length}
            onClick={() => jumpHit(-1)}
          >
            ‹
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Next match"
            disabled={!searchHits.length}
            onClick={() => jumpHit(1)}
          >
            ›
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close find"
            onClick={() => setSearchOpen(false)}
          >
            ×
          </button>
        </div>
      )}

      <div className="reader-body">
        <ReaderSidebar
          panel={panel}
          page={page}
          pageCount={pageCount}
          thumbs={thumbs}
          outline={outline}
          onSelectPage={goToPage}
          onClose={() => setPanel(null)}
        />

        <div className="stage" ref={stageRef}>
          {loading && <div className="loading">Opening document…</div>}
          {error && <div className="loading">{error}</div>}
          <div className={`stage-inner ${viewMode}`}>
            {pdf &&
              pagesToRender.map((p) => (
                <PageView
                  key={`${p}-${rotation}`}
                  pdf={pdf}
                  page={p}
                  zoom={zoom}
                  rotation={rotation}
                  tool={tool}
                  annotations={annotations}
                  searchHits={searchHits}
                  activeHitIndex={hitIndex}
                  isActivePage={p === page}
                  onActivate={() => setPage(p)}
                  onAddAnno={addAnno}
                  onUpdateNote={updateNote}
                  onRemoveAnno={removeAnno}
                  onToast={showToast}
                  stageRef={stageRef}
                />
              ))}
          </div>
          {toast && <div className="status-toast">{toast}</div>}
        </div>
      </div>
    </div>
  );
}

function ToolBtn({
  id,
  label,
  active,
  onClick,
  disabled,
  children,
}: {
  id: string;
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: import("react").ReactNode;
}) {
  return (
    <button
      type="button"
      className={`tool ${active ? "active" : ""}`}
      aria-label={label}
      aria-pressed={active}
      data-tool={id}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
