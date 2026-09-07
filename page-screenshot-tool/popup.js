const elements = {
  captureVisible: document.querySelector("#capture-visible"),
  captureFull: document.querySelector("#capture-full"),
  previewStage: document.querySelector("#preview-stage"),
  preview: document.querySelector("#screenshot-preview"),
  empty: document.querySelector("#empty-state"),
  openPreview: document.querySelector("#open-preview"),
  loading: document.querySelector("#loading-state"),
  loadingTitle: document.querySelector("#loading-title"),
  loadingDetail: document.querySelector("#loading-detail"),
  livePreview: document.querySelector("#live-preview"),
  progress: document.querySelector("#progress-bar"),
  meta: document.querySelector("#image-meta"),
  status: document.querySelector("#status"),
  download: document.querySelector("#download"),
  copy: document.querySelector("#copy"),
  retake: document.querySelector("#retake")
};

const state = {
  record: null,
  objectUrl: null,
  capturing: false,
  captureTabId: null
};

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!response?.ok) return reject(new Error(response?.error || "The browser could not complete the request."));
      resolve(response);
    });
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function createFilename() {
  const now = new Date();
  const pad = (number) => String(number).padStart(2, "0");
  return `screenshot-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.png`;
}

function dataUrlToBlob(dataUrl) {
  const [header, encoded] = dataUrl.split(",");
  const mime = header.match(/data:([^;]+)/)?.[1] || "image/png";
  const bytes = atob(encoded);
  const array = new Uint8Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) array[index] = bytes.charCodeAt(index);
  return new Blob([array], { type: mime });
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("A captured image section could not be decoded."));
    image.src = source;
  });
}

async function readBlobDimensions(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const image = await loadImage(url);
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The final PNG could not be created.")), "image/png");
  });
}

function clearLivePreview() {
  const context = elements.livePreview.getContext("2d");
  context.clearRect(0, 0, elements.livePreview.width, elements.livePreview.height);
}

function drawLivePreview(image) {
  const canvas = elements.livePreview;
  const context = canvas.getContext("2d");
  const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#ffffff";
  context.fillRect((canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
}

function buildAxis(total, viewport) {
  if (!Number.isFinite(total) || !Number.isFinite(viewport) || total <= 0 || viewport <= 0) {
    throw new Error("The page reported invalid dimensions.");
  }

  const positions = [0];
  while (positions.at(-1) + viewport < total) {
    const next = positions.at(-1) + viewport;
    const finalPosition = Math.max(0, total - viewport);
    positions.push(next + viewport >= total ? finalPosition : next);
  }

  return positions.map((scroll, index) => ({
    scroll,
    start: index === 0 ? 0 : positions[index - 1] + viewport,
    end: Math.min(total, scroll + viewport)
  }));
}

function setBusy(isBusy, title = "Capturing page…", detail = "Preparing", progress = 0) {
  state.capturing = isBusy;
  elements.captureVisible.disabled = isBusy;
  elements.captureFull.disabled = isBusy;
  elements.download.disabled = isBusy || !state.record;
  elements.copy.disabled = isBusy || !state.record;
  elements.retake.disabled = isBusy || !state.record;
  elements.loading.hidden = !isBusy;
  elements.loadingTitle.textContent = title;
  elements.loadingDetail.textContent = detail;
  elements.progress.style.width = `${Math.max(4, Math.min(100, progress))}%`;
  if (isBusy) {
    hideStatus();
    clearLivePreview();
  }
}

function updateProgress(current, total) {
  const percent = Math.round((current / total) * 100);
  elements.loadingDetail.textContent = `Section ${current} of ${total}`;
  elements.progress.style.width = `${percent}%`;
}

function showStatus(message, type = "info") {
  elements.status.textContent = message;
  elements.status.className = `status ${type}`;
  elements.status.hidden = false;
}

function hideStatus() {
  elements.status.hidden = true;
  elements.status.textContent = "";
}

async function setRecord(record, persist = true) {
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.record = record;
  state.objectUrl = URL.createObjectURL(record.blob);
  elements.preview.src = state.objectUrl;
  elements.preview.hidden = false;
  elements.empty.hidden = true;
  elements.openPreview.hidden = false;
  elements.previewStage.classList.remove("empty");
  elements.meta.textContent = `${record.width.toLocaleString()} × ${record.height.toLocaleString()} · ${formatBytes(record.blob.size)}`;
  elements.meta.hidden = false;
  elements.download.disabled = false;
  elements.copy.disabled = false;
  elements.retake.disabled = false;
  if (persist) await ScreenshotStore.save(record);
}

async function captureVisible() {
  setBusy(true, "Capturing viewport…", "Reading the active tab", 25);
  try {
    const result = await sendMessage({ type: "CAPTURE_VISIBLE" });
    elements.progress.style.width = "75%";
    const blob = dataUrlToBlob(result.dataUrl);
    const liveImage = await loadImage(result.dataUrl);
    drawLivePreview(liveImage);
    const dimensions = await readBlobDimensions(blob);
    await setRecord({
      blob,
      ...dimensions,
      filename: createFilename(),
      createdAt: Date.now(),
      sourceUrl: result.url,
      sourceTitle: result.title,
      captureType: "Visible area"
    });
    showStatus("Visible area captured successfully.", "success");
  } catch (error) {
    showStatus(error.message || "Visible-area capture is unavailable on this page.", "error");
  } finally {
    setBusy(false);
  }
}

function chooseOutputScale(totalWidth, totalHeight, nativeScale) {
  const MAX_DIMENSION = 32760;
  const MAX_PIXELS = 80_000_000;
  return Math.min(
    nativeScale,
    MAX_DIMENSION / totalWidth,
    MAX_DIMENSION / totalHeight,
    Math.sqrt(MAX_PIXELS / (totalWidth * totalHeight))
  );
}

async function captureFullPage() {
  setBusy(true, "Capturing full page…", "Measuring page", 3);
  let prepared = false;

  try {
    const setup = await sendMessage({ type: "PREPARE_FULL_CAPTURE" });
    const { tab } = setup;
    let { metrics } = setup;
    if (metrics?.error) throw new Error(metrics.error);
    prepared = true;
    state.captureTabId = tab.id;

    elements.loadingTitle.textContent = "Preparing full page…";
    elements.loadingDetail.textContent = "Loading page sections";
    elements.progress.style.width = "6%";
    const stabilized = await sendMessage({
      type: "STABILIZE_FULL_CAPTURE",
      tabId: tab.id,
      windowId: tab.windowId
    });
    if (stabilized.metrics?.error) throw new Error(stabilized.metrics.error);
    metrics = stabilized.metrics;
    elements.loadingTitle.textContent = "Capturing page…";

    const xAxis = buildAxis(metrics.totalWidth, metrics.viewportWidth);
    const yAxis = buildAxis(metrics.totalHeight, metrics.viewportHeight);
    const tileCount = xAxis.length * yAxis.length;
    let completed = 0;
    let canvas;
    let context;
    let outputScale;

    for (let row = 0; row < yAxis.length; row += 1) {
      for (let column = 0; column < xAxis.length; column += 1) {
        const x = xAxis[column];
        const y = yAxis[row];
        let result;
        try {
          result = await sendMessage({
            type: "CAPTURE_FULL_TILE",
            tabId: tab.id,
            windowId: tab.windowId,
            tile: {
              x: x.scroll,
              y: y.scroll,
              isTop: row === 0,
              isBottom: row === yAxis.length - 1,
              isLeft: column === 0,
              isRight: column === xAxis.length - 1
            }
          });
        } catch (error) {
          throw new Error(`Capture stopped at section ${completed + 1} of ${tileCount}. ${error.message}`);
        }
        if (result.position?.error) throw new Error(result.position.error);
        if (
          result.position.viewportWidth !== metrics.viewportWidth ||
          result.position.viewportHeight !== metrics.viewportHeight
        ) {
          throw new Error("The browser window changed size during capture. Keep it steady and try again.");
        }
        if (
          Math.abs(result.position.x - x.scroll) > 1 ||
          Math.abs(result.position.y - y.scroll) > 1
        ) {
          throw new Error("The page layout changed while it was being captured. Wait for the page to finish loading and try again.");
        }

        const image = await loadImage(result.dataUrl);
        drawLivePreview(image);
        const sourceScaleX = image.naturalWidth / metrics.viewportWidth;
        const sourceScaleY = image.naturalHeight / metrics.viewportHeight;

        if (!canvas) {
          const nativeScale = Math.min(sourceScaleX, sourceScaleY);
          outputScale = chooseOutputScale(metrics.totalWidth, metrics.totalHeight, nativeScale);
          if (!Number.isFinite(outputScale) || outputScale <= 0.02) {
            throw new Error("This page is too large for the browser to render as one image.");
          }
          canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.ceil(metrics.totalWidth * outputScale));
          canvas.height = Math.max(1, Math.ceil(metrics.totalHeight * outputScale));
          context = canvas.getContext("2d", { alpha: false });
          if (!context) throw new Error("The browser could not allocate an image canvas for this page.");
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, canvas.width, canvas.height);
        }

        const sourceX = Math.max(0, (x.start - x.scroll) * sourceScaleX);
        const sourceY = Math.max(0, (y.start - y.scroll) * sourceScaleY);
        const sourceWidth = Math.max(1, (x.end - x.start) * sourceScaleX);
        const sourceHeight = Math.max(1, (y.end - y.start) * sourceScaleY);
        const destinationX = x.start * outputScale;
        const destinationY = y.start * outputScale;
        const destinationWidth = (x.end - x.start) * outputScale;
        const destinationHeight = (y.end - y.start) * outputScale;

        context.drawImage(
          image,
          sourceX,
          sourceY,
          Math.min(sourceWidth, image.naturalWidth - sourceX),
          Math.min(sourceHeight, image.naturalHeight - sourceY),
          destinationX,
          destinationY,
          destinationWidth,
          destinationHeight
        );

        completed += 1;
        updateProgress(completed, tileCount);
      }
    }

    elements.loadingDetail.textContent = "Creating final PNG";
    const blob = await canvasToBlob(canvas);
    await setRecord({
      blob,
      width: canvas.width,
      height: canvas.height,
      filename: createFilename(),
      createdAt: Date.now(),
      sourceUrl: tab.url,
      sourceTitle: tab.title,
      captureType: "Full page"
    });

    const scaled = outputScale + 0.01 < metrics.devicePixelRatio;
    showStatus(scaled ? "Full page captured. The very large page was scaled to fit browser image limits." : "Full page captured successfully.", "success");
  } catch (error) {
    showStatus(error.message || "Full-page capture is unavailable on this page.", "error");
  } finally {
    if (prepared && state.captureTabId) {
      try { await sendMessage({ type: "RESTORE_CAPTURE", tabId: state.captureTabId }); } catch (_error) { /* Best effort. */ }
    }
    state.captureTabId = null;
    setBusy(false);
  }
}

async function downloadScreenshot() {
  if (!state.record) return;
  const url = URL.createObjectURL(state.record.blob);
  try {
    await chrome.downloads.download({ url, filename: state.record.filename, saveAs: true });
    showStatus("Download started.", "success");
  } catch (error) {
    showStatus(error.message || "The screenshot could not be downloaded.", "error");
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}

async function copyScreenshot() {
  if (!state.record) return;
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": state.record.blob })]);
    showStatus("Screenshot copied successfully.", "success");
  } catch (_error) {
    showStatus("Clipboard access was blocked. Keep the popup open and try again.", "error");
  }
}

async function retakeScreenshot() {
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.objectUrl = null;
  state.record = null;
  elements.preview.removeAttribute("src");
  elements.preview.hidden = true;
  elements.empty.hidden = false;
  elements.openPreview.hidden = true;
  elements.meta.hidden = true;
  elements.previewStage.classList.add("empty");
  elements.download.disabled = true;
  elements.copy.disabled = true;
  elements.retake.disabled = true;
  hideStatus();
  await ScreenshotStore.clear();
}

elements.captureVisible.addEventListener("click", captureVisible);
elements.captureFull.addEventListener("click", captureFullPage);
elements.download.addEventListener("click", downloadScreenshot);
elements.copy.addEventListener("click", copyScreenshot);
elements.retake.addEventListener("click", retakeScreenshot);
elements.openPreview.addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("preview.html") }));

window.addEventListener("pagehide", () => {
  if (state.capturing && state.captureTabId) {
    chrome.runtime.sendMessage({ type: "RESTORE_CAPTURE", tabId: state.captureTabId });
  }
});

(async () => {
  try {
    const record = await ScreenshotStore.load();
    if (record?.blob) await setRecord(record, false);
  } catch (_error) {
    // A previous preview is optional; capture remains fully available.
  }
})();
