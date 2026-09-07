const image = document.querySelector("#image");
const viewer = document.querySelector("#viewer");
const message = document.querySelector("#message");
const metadata = document.querySelector("#metadata");
const fitButton = document.querySelector("#fit");
const actualButton = document.querySelector("#actual");
const copyButton = document.querySelector("#copy");
const downloadButton = document.querySelector("#download");
const toast = document.querySelector("#toast");
let record;
let imageUrl;
let toastTimer;

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function showToast(text, isError = false) {
  clearTimeout(toastTimer);
  toast.textContent = text;
  toast.className = `toast${isError ? " error" : ""}`;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
}

fitButton.addEventListener("click", () => {
  viewer.className = "viewer fit-mode";
  fitButton.classList.add("active");
  actualButton.classList.remove("active");
});

actualButton.addEventListener("click", () => {
  viewer.className = "viewer actual-mode";
  actualButton.classList.add("active");
  fitButton.classList.remove("active");
});

downloadButton.addEventListener("click", async () => {
  if (!record) return;
  const url = URL.createObjectURL(record.blob);
  try {
    await chrome.downloads.download({ url, filename: record.filename, saveAs: true });
    showToast("Download started.");
  } catch (error) {
    showToast(error.message || "Download failed.", true);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
});

copyButton.addEventListener("click", async () => {
  if (!record) return;
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": record.blob })]);
    showToast("Screenshot copied successfully.");
  } catch (_error) {
    showToast("Clipboard access was blocked.", true);
  }
});

(async () => {
  try {
    record = await ScreenshotStore.load();
    if (!record?.blob) throw new Error("No screenshot is available. Capture a page from the extension popup first.");
    imageUrl = URL.createObjectURL(record.blob);
    image.src = imageUrl;
    image.hidden = false;
    message.hidden = true;
    metadata.textContent = `${record.captureType} · ${record.width.toLocaleString()} × ${record.height.toLocaleString()} · ${formatBytes(record.blob.size)} · ${record.sourceTitle || "Untitled page"}`;
  } catch (error) {
    message.textContent = error.message;
    copyButton.disabled = true;
    downloadButton.disabled = true;
  }
})();

window.addEventListener("pagehide", () => {
  if (imageUrl) URL.revokeObjectURL(imageUrl);
});
