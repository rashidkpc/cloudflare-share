const shareId = document.body.dataset.share;

const list = document.getElementById("assets");
const titleEl = document.getElementById("title");
const saveTitleBtn = document.getElementById("save-title");
const shareUrlEl = document.getElementById("post-url");
const copyBtn = document.getElementById("copy-link");
const addBtn = document.getElementById("add");
const addInput = document.getElementById("add-input");
const deleteShareBtn = document.getElementById("delete-share");
const resetBtn = document.getElementById("reset");
const resetTtlEl = document.getElementById("reset-ttl");
const progressEl = document.getElementById("progress");
const progressFill = document.getElementById("progress-fill");
const progressLabel = document.getElementById("progress-label");
const noticeEl = document.getElementById("notice");

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

function humanBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
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

function assetIds() {
  return [...list.children].map((item) => item.dataset.id);
}

async function saveOrder() {
  try {
    const response = await fetch("/api/posts/" + shareId + "/order", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assetIds: assetIds() }),
    });
    if (!response.ok) notice("Could not save the new order.");
    else notice("");
  } catch {
    notice("Could not save the new order.");
  }
}

let dragging = null;

list.addEventListener("dragstart", (event) => {
  const item = event.target.closest(".manage-item");
  if (!item) return;
  dragging = item;
  item.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", item.dataset.id);
});

list.addEventListener("dragend", () => {
  if (dragging) dragging.classList.remove("dragging");
  dragging = null;
});

list.addEventListener("dragover", (event) => {
  if (!dragging) return;
  event.preventDefault();

  const target = event.target.closest(".manage-item");
  if (!target || target === dragging) return;

  const rect = target.getBoundingClientRect();
  const sameRow = event.clientY >= rect.top && event.clientY <= rect.bottom;
  const after = sameRow
    ? event.clientX > rect.left + rect.width / 2
    : event.clientY > rect.top + rect.height / 2;

  if (after) target.after(dragging);
  else target.before(dragging);
});

list.addEventListener("drop", (event) => {
  event.preventDefault();
  if (dragging) saveOrder();
});

list.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;

  const item = button.closest(".manage-item");
  if (!item) return;

  const move = button.dataset.move;
  if (move) {
    const delta = Number(move);
    if (delta < 0 && item.previousElementSibling) {
      item.previousElementSibling.before(item);
    } else if (delta > 0 && item.nextElementSibling) {
      item.nextElementSibling.after(item);
    }
    await saveOrder();
    return;
  }

  if (button.hasAttribute("data-delete")) {
    if (!confirm("Delete this file from the share?")) return;

    button.disabled = true;
    try {
      const response = await fetch(
        "/api/posts/" + shareId + "/assets/" + item.dataset.id,
        { method: "DELETE" },
      );
      if (response.ok) {
        item.remove();
        if (list.children.length === 0) location.reload();
      } else {
        button.disabled = false;
        notice("Could not delete that file.");
      }
    } catch {
      button.disabled = false;
      notice("Could not delete that file.");
    }
  }
});

saveTitleBtn.addEventListener("click", async () => {
  saveTitleBtn.disabled = true;
  try {
    const response = await fetch("/api/posts/" + shareId, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: titleEl.value.trim() }),
    });
    if (!response.ok) {
      notice("Could not save the title.");
    } else {
      saveTitleBtn.textContent = "Saved";
      setTimeout(() => {
        saveTitleBtn.textContent = "Save";
      }, 1200);
    }
  } catch {
    notice("Could not save the title.");
  } finally {
    saveTitleBtn.disabled = false;
  }
});

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(shareUrlEl.value);
    copyBtn.textContent = "Copied";
    setTimeout(() => {
      copyBtn.textContent = "Copy";
    }, 1200);
  } catch {
    shareUrlEl.select();
    document.execCommand("copy");
  }
});

addBtn.addEventListener("click", () => addInput.click());

addInput.addEventListener("change", async () => {
  const files = [...(addInput.files || [])];
  addInput.value = "";
  if (files.length === 0) return;

  const total = files.reduce((sum, file) => sum + file.size, 0) || 1;
  let done = 0;
  let failed = false;

  addBtn.disabled = true;
  showProgress(0, "Uploading 1 of " + files.length + "…");

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const params = new URLSearchParams();
    params.set("filename", file.name);

    try {
      const { status, payload } = await postBody(
        "/api/posts/" + shareId + "/assets?" + params.toString(),
        file,
        (fraction) =>
          showProgress(
            (done + fraction * file.size) / total,
            "Uploading " + (index + 1) + " of " + files.length + "…",
          ),
      );

      if (status >= 200 && status < 300) {
        done += file.size;
      } else {
        notice((payload && payload.error) || "Upload failed (" + status + ").");
        failed = true;
        break;
      }
    } catch {
      notice("Network error while uploading.");
      failed = true;
      break;
    }
  }

  addBtn.disabled = false;
  hideProgress();

  if (!failed) location.reload();
});

resetBtn.addEventListener("click", async () => {
  if (!confirm("Reset the countdown and the request counter for this share?")) return;

  resetBtn.disabled = true;
  try {
    const response = await fetch("/api/posts/" + shareId + "/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ttl: Number(resetTtlEl.value) }),
    });
    if (response.ok) {
      location.reload();
      return;
    }
    const payload = await response.json().catch(() => null);
    notice((payload && payload.error) || "Could not reset the share.");
  } catch {
    notice("Could not reset the share.");
  }
  resetBtn.disabled = false;
});

deleteShareBtn.addEventListener("click", async () => {
  if (!confirm("Delete this share and everything in it?")) return;

  deleteShareBtn.disabled = true;
  try {
    const response = await fetch("/api/posts/" + shareId, { method: "DELETE" });
    if (response.ok) {
      location.href = "/upload";
      return;
    }
    notice("Could not delete this share.");
  } catch {
    notice("Could not delete this share.");
  }
  deleteShareBtn.disabled = false;
});

// Keep the size labels honest without a page reload after deletions.
function refreshCounts() {
  const count = list.children.length;
  if (count === 0) return;
}

refreshCounts();
