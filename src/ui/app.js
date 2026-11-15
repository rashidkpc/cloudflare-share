const config = JSON.parse(document.body.dataset.config);

const dropEl = document.getElementById("drop");
const fileEl = document.getElementById("file");
const presetsEl = document.getElementById("presets");
const titleEl = document.getElementById("title");
const progressEl = document.getElementById("progress");
const progressFill = document.getElementById("progress-fill");
const progressLabel = document.getElementById("progress-label");
const noticeEl = document.getElementById("notice");
const maxEl = document.getElementById("max-images");

let ttl = config.defaultTtlSeconds;
let uploading = false;

maxEl.textContent = String(config.maxAssets);

function notice(message) {
  if (!message) {
    noticeEl.hidden = true;
    noticeEl.textContent = "";
    return;
  }
  noticeEl.hidden = false;
  noticeEl.textContent = message;
}

function showProgress(fraction, label) {
  progressEl.hidden = false;
  progressFill.style.width = (Math.max(0, Math.min(1, fraction)) * 100).toFixed(1) + "%";
  progressLabel.textContent = label || "";
}

function hideProgress() {
  progressEl.hidden = true;
  progressFill.style.width = "0%";
  progressLabel.textContent = "";
}

function postBody(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.responseType = "json";
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    });
    xhr.addEventListener("load", () => resolve({ status: xhr.status, payload: xhr.response }));
    xhr.addEventListener("error", () => reject(new Error("network")));
    xhr.send(file);
  });
}

function buildPresets() {
  for (const preset of config.presets) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "preset";
    button.textContent = preset.label;
    button.dataset.seconds = String(preset.seconds);
    button.setAttribute("aria-pressed", String(preset.seconds === ttl));
    button.addEventListener("click", () => {
      if (uploading) return;
      ttl = preset.seconds;
      for (const other of presetsEl.children) {
        other.setAttribute("aria-pressed", String(other === button));
      }
    });
    presetsEl.append(button);
  }
}

async function uploadBatch(files) {
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0) || 1;

  uploading = true;
  dropEl.classList.add("busy");
  showProgress(0, "Uploading 1 of " + files.length + "…");

  let shareId = null;
  let doneBytes = 0;
  let error = "";

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const creating = !shareId;

    const params = new URLSearchParams();
    params.set("filename", file.name);
    if (creating) {
      params.set("ttl", String(ttl));
      const title = titleEl.value.trim();
      if (title) params.set("title", title);
    }

    const url =
      (creating ? "/api/upload" : "/api/posts/" + shareId + "/assets") + "?" + params.toString();

    try {
      const { status, payload } = await postBody(url, file, (fraction) => {
        showProgress(
          (doneBytes + fraction * file.size) / totalBytes,
          "Uploading " + (index + 1) + " of " + files.length + "…",
        );
      });

      if (status < 200 || status >= 300 || !payload) {
        error = (payload && payload.error) || "Upload failed (" + status + ").";
        break;
      }

      if (creating) shareId = payload.id;
      doneBytes += file.size;
    } catch {
      error = "Network error while uploading.";
      break;
    }
  }

  uploading = false;
  dropEl.classList.remove("busy");
  hideProgress();

  if (shareId) {
    // The manage page owns reordering, deletions and further uploads.
    location.href = "/m/" + shareId;
    return;
  }

  notice(error || "Upload failed.");
}

function handleFiles(fileList) {
  notice("");
  if (uploading) {
    notice("Still uploading — wait a moment.");
    return;
  }

  const incoming = [];
  for (const file of fileList) {
    if (file.size === 0) {
      notice(file.name + " is empty.");
      continue;
    }
    if (file.size > config.maxUploadBytes) {
      notice(file.name + " is too large (max " + humanBytes(config.maxUploadBytes) + ").");
      continue;
    }
    incoming.push(file);
  }

  if (incoming.length === 0) return;

  if (incoming.length > config.maxAssets) {
    notice("Only " + config.maxAssets + " files fit in a share.");
    incoming.length = config.maxAssets;
  }

  uploadBatch(incoming);
}

function humanBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

dropEl.addEventListener("click", () => {
  if (!uploading) fileEl.click();
});

dropEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    if (!uploading) fileEl.click();
  }
});

fileEl.addEventListener("change", () => {
  if (fileEl.files) handleFiles(fileEl.files);
  fileEl.value = "";
});

for (const type of ["dragenter", "dragover"]) {
  dropEl.addEventListener(type, (event) => {
    event.preventDefault();
    dropEl.classList.add("active");
  });
}

for (const type of ["dragleave", "drop"]) {
  dropEl.addEventListener(type, (event) => {
    event.preventDefault();
    dropEl.classList.remove("active");
  });
}

dropEl.addEventListener("drop", (event) => {
  const files = event.dataTransfer && event.dataTransfer.files;
  if (files) handleFiles(files);
});

document.addEventListener("paste", (event) => {
  const items = event.clipboardData && event.clipboardData.items;
  if (!items) return;

  const pasted = [];
  for (const item of items) {
    if (item.kind === "file") {
      const file = item.getAsFile();
      if (file) pasted.push(file);
    }
  }

  if (pasted.length) {
    event.preventDefault();
    handleFiles(pasted);
  }
});

buildPresets();
