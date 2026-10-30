/**
 * Serialize pdf.js page paints. Concurrent PageView renders on WebKitGTK
 * (Tauri Linux) routinely cancel each other or finish as white bitmaps while
 * a parallel thumb worker is fine — matching "thumbs OK, main blank".
 */
let chain: Promise<void> = Promise.resolve();

export function enqueuePageRender<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  // Keep the queue moving even when a task rejects.
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
