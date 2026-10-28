import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { openPdf } from "../lib/pdf";
import { loadDocStore, upsertAnnotations } from "../lib/storage";
import type {
  Annotation,
  HighlightAnno,
  InkAnno,
  LibraryDoc,
  NoteAnno,
  Point,
  Tool,
} from "../types";

type Props = {
  doc: LibraryDoc;
  onBack: () => void;
  onMeta: (pageCount: number, lastPage: number) => void;
};

const HIGHLIGHT_COLOR = "rgba(232, 195, 122, 0.45)";
const INK_COLOR = "#2a6f7a";

function uid() {
  return crypto.randomUUID();
}

export function Reader({ doc, onBack, onMeta }: Props) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(1.15);
  const [tool, setTool] = useState<Tool>("pan");
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inkRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pageSizeRef = useRef({ w: 0, h: 0 });
  const drawingRef = useRef<Point[] | null>(null);
  const dragRef = useRef<{
    mode: "highlight" | "pan";
    startX: number;
    startY: number;
    originScrollX: number;
    originScrollY: number;
  } | null>(null);
  const [draftRect, setDraftRect] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const [draggingPan, setDraggingPan] = useState(false);

  // Load doc + annotations
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const store = loadDocStore(doc.id);
        if (!cancelled) {
          setAnnotations(store.annotations);
          setPage(store.lastPage || 1);
          setZoom(store.zoom || 1.15);
        }
        const proxy = await openPdf(doc.url);
        if (cancelled) return;
        setPdf(proxy);
        setPageCount(proxy.numPages);
        onMeta(proxy.numPages, store.lastPage || 1);
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

  // Persist annotations
  useEffect(() => {
    if (!pdf) return;
    upsertAnnotations(doc.id, annotations, { lastPage: page, zoom });
  }, [annotations, doc.id, page, zoom, pdf]);

  const pageAnnos = useMemo(
    () => annotations.filter((a) => a.page === page),
    [annotations, page],
  );

  // Render PDF page
  useEffect(() => {
    if (!pdf || !canvasRef.current) return;
    let cancelled = false;
    (async () => {
      const pg = await pdf.getPage(page);
      if (cancelled || !canvasRef.current) return;
      const viewport = pg.getViewport({ scale: zoom });
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      pageSizeRef.current = { w: viewport.width, h: viewport.height };
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      await pg.render({ canvas, canvasContext: ctx, viewport }).promise;
      // Resize ink canvas
      if (inkRef.current) {
        inkRef.current.width = canvas.width;
        inkRef.current.height = canvas.height;
        inkRef.current.style.width = canvas.style.width;
        inkRef.current.style.height = canvas.style.height;
        redrawInk(inkRef.current, pageAnnos, viewport.width, viewport.height, dpr);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf, page, zoom, pageAnnos]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1800);
  }, []);

  const toNorm = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height,
    };
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (!canvasRef.current) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);

    if (tool === "note") {
      const p = toNorm(e.clientX, e.clientY);
      const note: NoteAnno = {
        id: uid(),
        type: "note",
        page,
        x: p.x,
        y: p.y,
        text: "",
        color: "#ffe08a",
      };
      setAnnotations((prev) => [...prev, note]);
      setTool("pan");
      showToast("Sticky note added");
      return;
    }

    if (tool === "ink") {
      const p = toNorm(e.clientX, e.clientY);
      drawingRef.current = [p];
      return;
    }

    if (tool === "highlight") {
      const p = toNorm(e.clientX, e.clientY);
      dragRef.current = {
        mode: "highlight",
        startX: p.x,
        startY: p.y,
        originScrollX: 0,
        originScrollY: 0,
      };
      setDraftRect({ x: p.x, y: p.y, w: 0, h: 0 });
      return;
    }

    // pan
    dragRef.current = {
      mode: "pan",
      startX: e.clientX,
      startY: e.clientY,
      originScrollX: stageRef.current?.scrollLeft ?? 0,
      originScrollY: stageRef.current?.scrollTop ?? 0,
    };
    setDraggingPan(true);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (tool === "ink" && drawingRef.current) {
      const p = toNorm(e.clientX, e.clientY);
      drawingRef.current.push(p);
      const ink = inkRef.current;
      if (ink) {
        const dpr = window.devicePixelRatio || 1;
        const ctx = ink.getContext("2d");
        if (ctx) {
          const pts = drawingRef.current;
          const a = pts[pts.length - 2];
          const b = pts[pts.length - 1];
          ctx.save();
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.strokeStyle = INK_COLOR;
          ctx.lineWidth = 2.4;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.beginPath();
          ctx.moveTo(a.x * pageSizeRef.current.w, a.y * pageSizeRef.current.h);
          ctx.lineTo(b.x * pageSizeRef.current.w, b.y * pageSizeRef.current.h);
          ctx.stroke();
          ctx.restore();
        }
      }
      return;
    }

    const drag = dragRef.current;
    if (!drag) return;

    if (drag.mode === "highlight") {
      const p = toNorm(e.clientX, e.clientY);
      const x = Math.min(drag.startX, p.x);
      const y = Math.min(drag.startY, p.y);
      setDraftRect({
        x,
        y,
        w: Math.abs(p.x - drag.startX),
        h: Math.abs(p.y - drag.startY),
      });
      return;
    }

    if (drag.mode === "pan" && stageRef.current) {
      stageRef.current.scrollLeft = drag.originScrollX - (e.clientX - drag.startX);
      stageRef.current.scrollTop = drag.originScrollY - (e.clientY - drag.startY);
    }
  };

  const onPointerUp = () => {
    if (tool === "ink" && drawingRef.current && drawingRef.current.length > 1) {
      const ink: InkAnno = {
        id: uid(),
        type: "ink",
        page,
        points: drawingRef.current,
        color: INK_COLOR,
        width: 2.4,
      };
      setAnnotations((prev) => [...prev, ink]);
      drawingRef.current = null;
      showToast("Ink saved");
      return;
    }
    drawingRef.current = null;

    const drag = dragRef.current;
    if (drag?.mode === "highlight" && draftRect && draftRect.w > 0.01 && draftRect.h > 0.005) {
      const hl: HighlightAnno = {
        id: uid(),
        type: "highlight",
        page,
        x: draftRect.x,
        y: draftRect.y,
        w: draftRect.w,
        h: draftRect.h,
        color: HIGHLIGHT_COLOR,
      };
      setAnnotations((prev) => [...prev, hl]);
      showToast("Highlight saved");
    }
    dragRef.current = null;
    setDraftRect(null);
    setDraggingPan(false);
  };

  const updateNote = (id: string, text: string) => {
    setAnnotations((prev) =>
      prev.map((a) => (a.id === id && a.type === "note" ? { ...a, text } : a)),
    );
  };

  const removeAnno = (id: string) => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
    showToast("Removed");
  };

  const clearPage = () => {
    setAnnotations((prev) => prev.filter((a) => a.page !== page));
    showToast("Cleared page marks");
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowRight" || e.key === "j") setPage((p) => Math.min(pageCount, p + 1));
      if (e.key === "ArrowLeft" || e.key === "k") setPage((p) => Math.max(1, p - 1));
      if (e.key === "=" || e.key === "+") setZoom((z) => Math.min(3, +(z + 0.1).toFixed(2)));
      if (e.key === "-" || e.key === "_") setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2)));
      if (e.key === "1") setTool("pan");
      if (e.key === "2") setTool("highlight");
      if (e.key === "3") setTool("ink");
      if (e.key === "4") setTool("note");
      if (e.key === "Escape") onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pageCount, onBack]);

  return (
    <div className="reader">
      <header className="topbar">
        <button type="button" className="btn btn-ghost" onClick={onBack} style={{ padding: "0.45rem 0.9rem" }}>
          ← Library
        </button>
        <div className="brand-mini">Octavo</div>
        <div className="doc-title">{doc.title}</div>
        <div className="spacer" />

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
          <ToolBtn id="note" label="Sticky note" active={tool === "note"} onClick={() => setTool("note")}>
            ▤
          </ToolBtn>
        </div>

        <div className="chip">
          <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2)))}>
            −
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(3, +(z + 0.1).toFixed(2)))}>
            +
          </button>
        </div>

        <div className="chip">
          <button
            type="button"
            aria-label="Previous page"
            disabled={pageCount < 1 || page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
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
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          >
            ›
          </button>
        </div>

        <button type="button" className="btn btn-ghost" style={{ padding: "0.45rem 0.85rem" }} onClick={clearPage}>
          Clear page
        </button>
      </header>

      <div className="stage" ref={stageRef}>
        {loading && <div className="loading">Opening page…</div>}
        {error && <div className="loading">{error}</div>}
        <div className="stage-inner">
          <div className="page-stack">
            <canvas ref={canvasRef} className="pdf-canvas" />
            <canvas
              ref={inkRef}
              className="anno-layer"
              style={{ pointerEvents: "none" }}
            />
            <div
              className={`anno-layer ${tool === "pan" ? "pan" : "interactive"} ${draggingPan ? "dragging" : ""}`}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {pageAnnos
                .filter((a): a is HighlightAnno => a.type === "highlight")
                .map((h) => (
                  <div
                    key={h.id}
                    className="highlight-box"
                    style={{
                      left: `${h.x * 100}%`,
                      top: `${h.y * 100}%`,
                      width: `${h.w * 100}%`,
                      height: `${h.h * 100}%`,
                      background: h.color,
                    }}
                  />
                ))}
              {draftRect && (
                <div
                  className="draft-rect"
                  style={{
                    left: `${draftRect.x * 100}%`,
                    top: `${draftRect.y * 100}%`,
                    width: `${draftRect.w * 100}%`,
                    height: `${draftRect.h * 100}%`,
                  }}
                />
              )}
              {pageAnnos
                .filter((a): a is NoteAnno => a.type === "note")
                .map((n) => (
                  <div
                    key={n.id}
                    className="sticky"
                    style={{ left: `${n.x * 100}%`, top: `${n.y * 100}%` }}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="sticky-x"
                      aria-label="Delete note"
                      onClick={() => removeAnno(n.id)}
                    >
                      ×
                    </button>
                    <textarea
                      placeholder="Write a note…"
                      value={n.text}
                      autoFocus={!n.text}
                      onChange={(e) => updateNote(n.id, e.target.value)}
                    />
                  </div>
                ))}
            </div>
          </div>
        </div>
        {toast && <div className="status-toast">{toast}</div>}
      </div>
    </div>
  );
}

function ToolBtn({
  id,
  label,
  active,
  onClick,
  children,
}: {
  id: string;
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`tool ${active ? "active" : ""}`}
      aria-label={label}
      aria-pressed={active}
      data-tool={id}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function redrawInk(
  canvas: HTMLCanvasElement,
  annos: Annotation[],
  w: number,
  h: number,
  dpr: number,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const a of annos) {
    if (a.type !== "ink" || a.points.length < 2) continue;
    ctx.strokeStyle = a.color;
    ctx.lineWidth = a.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(a.points[0].x * w, a.points[0].y * h);
    for (let i = 1; i < a.points.length; i++) {
      ctx.lineTo(a.points[i].x * w, a.points[i].y * h);
    }
    ctx.stroke();
  }
}
