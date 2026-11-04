// Reads the text of a PDF in the browser, page by page. No AI and no upload.
export async function pdfPages(file, onProgress) {
  if (!Promise.withResolvers) {
    Promise.withResolvers = function () {
      let resolve;
      let reject;
      const promise = new Promise((a, b) => { resolve = a; reject = b; });
      return { promise, resolve, reject };
    };
  }
  const pdfjs = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    pages.push({ page: i, text: tc.items.map((x) => x.str).join(' ') });
    page.cleanup();
    onProgress?.(i, doc.numPages);
  }
  return pages;
}
