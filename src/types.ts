export type Tool = "pan" | "highlight" | "ink" | "note";

export type Point = { x: number; y: number };

export type HighlightAnno = {
  id: string;
  type: "highlight";
  page: number;
  /** Normalized 0–1 relative to page */
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
};

export type InkAnno = {
  id: string;
  type: "ink";
  page: number;
  points: Point[];
  color: string;
  width: number;
};

export type NoteAnno = {
  id: string;
  type: "note";
  page: number;
  x: number;
  y: number;
  text: string;
  color: string;
};

export type Annotation = HighlightAnno | InkAnno | NoteAnno;

export type LibraryDoc = {
  id: string;
  title: string;
  source: "sample" | "file";
  /** Object URL or public path */
  url: string;
  addedAt: number;
  pageCount?: number;
  lastPage?: number;
};

export type DocStore = {
  annotations: Annotation[];
  lastPage: number;
  zoom: number;
};
