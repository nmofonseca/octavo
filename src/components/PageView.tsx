import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  PAGE_RETRY_DELAYS_MS,
  isMostlyBlankCanvas,
  isRenderCancelledError,
} from "../lib/thumb-utils";
import type {
  Annotation,
  HighlightAnno,
  InkAnno,
  NoteAnno,
  Point,
  Rotation,
  SearchHit,
  Tool,
} from "../types";

type Props = {
  pdf: PDFDocumentProxy;
  page: number;
  zoom: number;
  rotation: Rotation;
  tool: Tool;
  annotations: Annotation[];
  searchHits: SearchHit[];
  activeHitIndex: number;
  isActivePage: boolean;
  onActivate: () => void;
  onAddAnno: (a: Annotation) => void;
  onUpdateNote: (id: string, text: string) => void;
  onRemoveAnno: (id: string) => void;
  onToast: (msg: string) => void;
  stageRef: React.RefObject<HTMLDivElement | null>;
};

const HIGHLIGHT_COLOR = "rgba(255, 122, 26, 0.42)";
const INK_COLOR = "#ff7a1a";

function uid() {
  return crypto.randomUUID();
}

export function PageView({
  pdf,
  page,
  zoom,
  rotation,
  tool,
  annotations,
  searchHits,
  activeHitIndex,
  isActivePage,
  onActivate,
  onAddAnno,
  onUpdateNote,
  onRemoveAnno,
  onToast,
  stageRef,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inkRef = useRef<HTMLCanvasElement>(null);
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
  const [ready, setReady] = useState(false);

  const pageAnnos = useMemo(
    () => annotations.filter((a) => a.page === page),
    [annotations, page],
  );

  const pageHits = useMemo(
    () =>
      searchHits
        .map((h, i) => ({ ...h, index: i }))
        .filter((h) => h.page === page),
    [searchHits, page],
  );

  // PDF paint — retries cancelled/blank results so thumb work cannot leave a
  // white main page. Annotation ink is a separate effect so mark edits do not
  // cancel an in-flight page.render().
  useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null =
      null;
    const delays = PAGE_RETRY_DELAYS_MS;

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, ms);
      });

    (async () => {
      setReady(false);
      let lastError: unknown;

      for (let i = 0; i < delays.length; i++) {
        if (cancelled) return;
        if (delays[i]) await sleep(delays[i]!);
        if (cancelled || !canvasRef.current) return;

        try {
          const pg = await pdf.getPage(page);
          if (cancelled || !canvasRef.current) return;

          const viewport = pg.getViewport({ scale: zoom, rotation });
          const canvas = canvasRef.current;
          const ctx = canvas.getContext("2d", { alpha: false });
          if (!ctx) return;

          const dpr = window.devicePixelRatio || 1;
          canvas.width = Math.floor(viewport.width * dpr);
          canvas.height = Math.floor(viewport.height * dpr);
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;
          pageSizeRef.current = { w: viewport.width, h: viewport.height };

          // Opaque white so a cancelled mid-paint never shows through as empty paper
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

          renderTask = pg.render({
            canvas,
            canvasContext: ctx,
            viewport,
            intent: "display",
            background: "#ffffff",
          });
          await renderTask.promise;
          renderTask = null;

          if (cancelled) return;

          // Image-heavy pages can finish with a white bitmap when starved —
          // retry instead of publishing a blank main view.
          if (isMostlyBlankCanvas(canvas)) {
            lastError = new Error(`Blank page render for page ${page}`);
            continue;
          }

          if (inkRef.current) {
            inkRef.current.width = canvas.width;
            inkRef.current.height = canvas.height;
            inkRef.current.style.width = canvas.style.width;
            inkRef.current.style.height = canvas.style.height;
            redrawInk(
              inkRef.current,
              pageAnnos,
              viewport.width,
              viewport.height,
              dpr,
            );
          }
          setReady(true);
          return;
        } catch (e) {
          renderTask = null;
          // Effect teardown cancel — stop; a new effect owns the next paint.
          if (cancelled) return;
          // Concurrent cancel (thumb starvation / StrictMode) — retry.
          if (isRenderCancelledError(e)) {
            lastError = e;
            continue;
          }
          throw e;
        }
      }

      if (!cancelled && lastError) {
        console.warn("[octavo] PageView paint failed after retries", lastError);
      }
    })();

    return () => {
      cancelled = true;
      try {
        renderTask?.cancel();
      } catch {
        /* ignore */
      }
    };
    // pageAnnos intentionally omitted — ink redraw is handled below
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment
  }, [pdf, page, zoom, rotation]);

  // Keep ink overlay in sync without re-running PDF page.render
  useEffect(() => {
    const ink = inkRef.current;
    const canvas = canvasRef.current;
    if (!ink || !canvas || !ready) return;
    const dpr = window.devicePixelRatio || 1;
    redrawInk(
      ink,
      pageAnnos,
      pageSizeRef.current.w,
      pageSizeRef.current.h,
      dpr,
    );
  }, [pageAnnos, ready]);

  const toNorm = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height,
    };
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (!canvasRef.current || !ready) return;
    onActivate();
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
        color: "#ffd28a",
      };
      onAddAnno(note);
      onToast("Sticky note added");
      return;
    }

    if (tool === "ink") {
      drawingRef.current = [toNorm(e.clientX, e.clientY)];
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
      setDraftRect({
        x: Math.min(drag.startX, p.x),
        y: Math.min(drag.startY, p.y),
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
      onAddAnno(ink);
      drawingRef.current = null;
      onToast("Ink saved");
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
      onAddAnno(hl);
      onToast("Highlight saved");
    }
    dragRef.current = null;
    setDraftRect(null);
    setDraggingPan(false);
  };

  return (
    <div
      className={`page-stack ${isActivePage ? "active-page" : ""}`}
      data-page={page}
      id={`octavo-page-${page}`}
    >
      <canvas ref={canvasRef} className="pdf-canvas" />
      <canvas ref={inkRef} className="anno-layer" style={{ pointerEvents: "none" }} />
      <div
        className={`anno-layer ${tool === "pan" ? "pan" : "interactive"} ${draggingPan ? "dragging" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {pageHits.map((h) => (
          <div
            key={`hit-${h.index}`}
            className={`search-hit ${h.index === activeHitIndex ? "current" : ""}`}
            style={{
              left: `${h.x * 100}%`,
              top: `${h.y * 100}%`,
              width: `${h.w * 100}%`,
              height: `${h.h * 100}%`,
            }}
          />
        ))}
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
                onClick={() => onRemoveAnno(n.id)}
              >
                ×
              </button>
              <textarea
                placeholder="Write a note…"
                value={n.text}
                autoFocus={!n.text}
                onChange={(e) => onUpdateNote(n.id, e.target.value)}
              />
            </div>
          ))}
      </div>
    </div>
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
