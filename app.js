const fileInput = document.querySelector("#fileInput");
const pickButton = document.querySelector("#pickButton");
const dropZone = document.querySelector("#dropZone");
const results = document.querySelector("#results");
const emptyState = document.querySelector("#emptyState");
const clearButton = document.querySelector("#clearButton");
const downloadAllButton = document.querySelector("#downloadAllButton");
const formatSelect = document.querySelector("#formatSelect");
const edgeSelect = document.querySelector("#edgeSelect");
const customSizeFields = document.querySelector("#customSizeFields");
const customWidth = document.querySelector("#customWidth");
const customHeight = document.querySelector("#customHeight");
const customFitInputs = document.querySelectorAll("input[name='customFit']");
const template = document.querySelector("#resultTemplate");
const dropWarning = document.querySelector("#dropWarning");

const processedUrls = [];
const records = [];
const maxFiles = 30;
let reprocessTimer = 0;

document.querySelectorAll("input[name='compressMode']").forEach((input) => {
  input.addEventListener("change", () => scheduleReprocess());
});

formatSelect.addEventListener("change", () => scheduleReprocess());
edgeSelect.addEventListener("change", () => {
  updateCustomSizeVisibility();
  scheduleReprocess();
});
customWidth.addEventListener("input", () => scheduleReprocess());
customHeight.addEventListener("input", () => scheduleReprocess());
customFitInputs.forEach((input) => {
  input.addEventListener("change", () => scheduleReprocess());
});

pickButton.addEventListener("click", (event) => {
  event.stopPropagation();
  fileInput.click();
});
dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    fileInput.click();
  }
});

fileInput.addEventListener("change", () => {
  handleFiles(fileInput.files);
  fileInput.value = "";
});

["dragenter", "dragover"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("is-dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-dragging");
  });
});

dropZone.addEventListener("drop", (event) => {
  handleFiles(event.dataTransfer.files);
});

clearButton.addEventListener("click", () => {
  processedUrls.forEach((url) => URL.revokeObjectURL(url));
  processedUrls.length = 0;
  records.length = 0;
  results.innerHTML = "";
  updateEmptyState();
});

downloadAllButton.addEventListener("click", () => downloadAllRecords());

results.addEventListener("click", (event) => {
  const card = event.target.closest(".result-card");
  if (!card) return;

  const record = records.find((item) => item.node === card);
  if (!record) return;

  if (event.target.closest(".download-button")) {
    saveRecord(record);
  }

  if (event.target.closest(".remove-button")) {
    removeRecord(record);
  }
});

function getSettings() {
  const isCustomSize = edgeSelect.value === "custom";
  const presetSize = getPresetSize(edgeSelect.value);

  return {
    targetBytes: 10 * 1024 * 1024,
    mode: document.querySelector("input[name='compressMode']:checked").value,
    format: formatSelect.value,
    maxWidth: isCustomSize ? 0 : presetSize.width,
    maxHeight: isCustomSize ? 0 : presetSize.height,
    customWidth: isCustomSize ? Number(customWidth.value) : 0,
    customHeight: isCustomSize ? Number(customHeight.value) : 0,
    customFit: isCustomSize ? document.querySelector("input[name='customFit']:checked").value : "contain",
    quality: document.querySelector("input[name='compressMode']:checked").value === "extreme" ? 0.62 : 0.95,
    autoFit: true,
  };
}

function getPresetSize(value) {
  const match = value.match(/^(\d+)x(\d+)$/);

  if (!match) {
    return { width: 0, height: 0 };
  }

  return {
    width: Number(match[1]),
    height: Number(match[2]),
  };
}

function updateCustomSizeVisibility() {
  customSizeFields.hidden = edgeSelect.value !== "custom";
}

function handleFiles(fileList) {
  const imageFiles = Array.from(fileList).filter((file) => file.type.startsWith("image/"));
  const files = imageFiles.slice(0, Math.max(0, maxFiles - records.length));

  if (!files.length && !imageFiles.length) return;

  const gifCount = files.filter(isGifFile).length;
  const largeCount = files.filter((file) => file.size >= 50 * 1024 * 1024).length;
  const warnings = [];

  if (imageFiles.length > files.length) {
    warnings.push("一度に追加できる画像は最大30枚までです。");
  }

  if (gifCount > 0) {
    warnings.push("GIFは静止画像として変換されます。アニメーションは保存されません。");
  }

  if (largeCount > 0) {
    warnings.push("大きめの画像です。処理に少し時間がかかる場合があります。");
  }

  dropWarning.hidden = warnings.length === 0;
  dropWarning.textContent = warnings.join(" ");

  emptyState.hidden = true;
  clearButton.disabled = false;
  files.forEach((file) => addResult(file));
}

function addResult(file) {
  const node = template.content.firstElementChild.cloneNode(true);
  const record = {
    file,
    node,
    url: null,
    blob: null,
    extension: null,
    version: 0,
  };
  const title = record.node.querySelector("h3");
  const originalStat = record.node.querySelector("[data-original]");

  title.textContent = file.name;
  originalStat.textContent = formatBytes(file.size);
  results.prepend(node);
  records.push(record);
  updateRecordNumbers();
  processRecord(record);
}

function scheduleReprocess() {
  if (!records.length) return;

  window.clearTimeout(reprocessTimer);
  reprocessTimer = window.setTimeout(() => {
    records.forEach((record) => processRecord(record));
  }, 250);
}

function processRecord(record) {
  const image = record.node.querySelector("img");
  const status = record.node.querySelector(".status-text");
  const outputStat = record.node.querySelector("[data-output]");
  const savedStat = record.node.querySelector("[data-saved]");
  const downloadButton = record.node.querySelector(".download-button");
  const removeButton = record.node.querySelector(".remove-button");
  const currentVersion = record.version + 1;

  record.version = currentVersion;
  status.textContent = "設定を反映して処理中...";
  status.className = "status-text";
  outputStat.textContent = "-";
  savedStat.textContent = "-";
  downloadButton.hidden = true;
  removeButton.hidden = false;

  compressImage(record.file)
    .then((result) => {
      if (record.version !== currentVersion) {
        URL.revokeObjectURL(result.url);
        return;
      }

      if (record.url) {
        URL.revokeObjectURL(record.url);
      }

      record.url = result.url;
      record.blob = result.blob;
      record.extension = result.extension;
      image.src = result.url;
      image.alt = `${record.file.name} のプレビュー`;
      outputStat.textContent = formatBytes(result.blob.size);
      savedStat.textContent = formatSavedRatio(record.file.size, result.blob.size);
      status.textContent = isGifFile(record.file)
        ? "GIFは静止画像として変換されました。アニメーションは保存されていません。"
        : getResultMessage(result);
      status.classList.add(result.hitTarget ? "success" : "warning");
      downloadButton.hidden = false;
      processedUrls.push(result.url);
      updateEmptyState();
    })
    .catch((error) => {
      if (record.version !== currentVersion) return;
      status.textContent = error.message || "この画像は処理できませんでした。";
      status.classList.add("warning");
      updateEmptyState();
    });
}

function saveRecord(record) {
  if (!record.blob || record.blob.size === 0 || !record.url) return;

  const link = document.createElement("a");
  link.href = record.url;
  link.download = makeOutputName(record.file.name, record.extension);
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function removeRecord(record) {
  if (record.url) {
    URL.revokeObjectURL(record.url);
    const urlIndex = processedUrls.indexOf(record.url);
    if (urlIndex >= 0) {
      processedUrls.splice(urlIndex, 1);
    }
  }

  const index = records.indexOf(record);
  if (index >= 0) {
    records.splice(index, 1);
  }

  record.node.remove();
  updateRecordNumbers();
  updateEmptyState();
}

async function downloadAllRecords() {
  const readyRecords = records.filter((record) => record.blob && record.blob.size > 0);

  if (!readyRecords.length) return;

  downloadAllButton.disabled = true;
  downloadAllButton.textContent = "準備中...";

  try {
    const files = readyRecords.map((record, index) => ({
      name: makeUniqueZipName(makeOutputName(record.file.name, record.extension), index),
      blob: record.blob,
    }));
    const zipBlob = await createZip(files);
    const zipUrl = URL.createObjectURL(zipBlob);
    const link = document.createElement("a");
    link.href = zipUrl;
    link.download = "dissize-images.zip";
    link.rel = "noopener";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(zipUrl), 1000);
  } finally {
    downloadAllButton.textContent = "まとめて保存";
    updateEmptyState();
  }
}

function makeUniqueZipName(fileName, index) {
  return `${String(index + 1).padStart(2, "0")}-${fileName}`;
}

function isGifFile(file) {
  return file.type === "image/gif" || /\.gif$/i.test(file.name);
}

async function compressImage(file) {
  const settings = getSettings();
  const bitmap = await createImageBitmap(file);
  let width = bitmap.width;
  let height = bitmap.height;
  let scale = getInitialScale(width, height, settings);
  let blob = null;

  if (settings.mode === "extreme") {
    blob = await compressExtreme(bitmap, width, height, scale, settings);
  } else if (!settings.autoFit || settings.format === "image/png") {
    const canvas = drawBitmap(bitmap, Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)), settings);
    blob = await canvasToBlob(canvas, settings.format, settings.quality);
  } else {
    blob = await compressNearLimit(bitmap, width, height, scale, settings);
  }

  bitmap.close?.();

  if (!blob) {
    throw new Error("画像の変換に失敗しました。");
  }

  const url = URL.createObjectURL(blob);
  return {
    blob,
    url,
    hitTarget: blob.size <= settings.targetBytes,
    mode: settings.mode,
    extension: extensionFor(settings.format),
  };
}

function getInitialScale(width, height, settings) {
  if (settings.customWidth > 0 && settings.customHeight > 0) {
    if (settings.customFit === "cover") {
      return Math.max(settings.customWidth / width, settings.customHeight / height);
    }

    return Math.min(1, settings.customWidth / width, settings.customHeight / height);
  }

  if (settings.maxWidth > 0 && settings.maxHeight > 0) {
    return Math.max(settings.maxWidth / width, settings.maxHeight / height);
  }

  return 1;
}

function getResultMessage(result) {
  if (!result.hitTarget) {
    if (result.mode === "extreme") {
      return "10MB未満に収まりませんでした。解像度を下げるか、JPGまたはWebPでお試しください。10MB以上でも問題ない場合は、このまま保存できます。";
    }

    return "10MB未満に収まりませんでした。解像度を下げるか、極限圧縮をお試しください。10MB以上でも問題ない場合は、このまま保存できます。";
  }

  return "10MB未満の目標容量内に収まりました。";
}

async function compressNearLimit(bitmap, width, height, scale, settings) {
  const targetFloor = settings.targetBytes * 0.92;
  const minQuality = 0.42;
  const maxScale = scale;
  const fixedResolution = shouldUseFixedResolution(settings);
  let bestUnderTarget = null;
  let largestUnderTarget = null;
  let smallestCandidate = null;

  for (let scaleAttempt = 0; scaleAttempt < 8; scaleAttempt += 1) {
    const canvas = drawBitmap(bitmap, Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)), settings);
    let low = minQuality;
    let high = settings.quality;

    for (let qualityAttempt = 0; qualityAttempt < 7; qualityAttempt += 1) {
      const quality = (low + high) / 2;
      const candidate = await canvasToBlob(canvas, settings.format, quality);

      if (!smallestCandidate || candidate.size < smallestCandidate.size) {
        smallestCandidate = candidate;
      }

      if (candidate.size <= settings.targetBytes) {
        bestUnderTarget = candidate;
        low = quality;

        if (!largestUnderTarget || candidate.size > largestUnderTarget.size) {
          largestUnderTarget = candidate;
        }
      } else {
        high = quality;
      }
    }

    if (bestUnderTarget && bestUnderTarget.size >= targetFloor) {
      return bestUnderTarget;
    }

    if (bestUnderTarget && scale < 1) {
      const nextScale = Math.min(maxScale, scale * 1.18);
      if (nextScale === scale) {
        return largestUnderTarget || bestUnderTarget;
      }
      scale = nextScale;
    } else if (bestUnderTarget) {
      return largestUnderTarget || bestUnderTarget;
    } else if (!fixedResolution) {
      scale *= 0.82;
    } else {
      break;
    }
  }

  return largestUnderTarget || bestUnderTarget || smallestCandidate;
}

async function compressExtreme(bitmap, width, height, scale, settings) {
  if (shouldUseFixedResolution(settings)) {
    const canvas = drawBitmap(bitmap, Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)), settings);
    return canvasToBlob(canvas, settings.format, 0.42);
  }

  const presetEdge = Math.max(settings.maxWidth || 0, settings.maxHeight || 0);
  const extremeMaxEdge = Math.min(presetEdge || 1280, 1280);
  let extremeScale = Math.min(scale, extremeMaxEdge / Math.max(width, height));
  let smallest = null;

  for (let attempt = 0; attempt < 7; attempt += 1) {
    const canvas = drawBitmap(bitmap, Math.max(1, Math.round(width * extremeScale)), Math.max(1, Math.round(height * extremeScale)), settings);
    const quality = Math.max(0.28, 0.62 - attempt * 0.05);
    const candidate = await canvasToBlob(canvas, settings.format, quality);

    if (!smallest || candidate.size < smallest.size) {
      smallest = candidate;
    }

    if (candidate.size <= settings.targetBytes * 0.35) {
      return candidate;
    }

    extremeScale *= 0.78;
  }

  return smallest;
}

function drawBitmap(bitmap, width, height, settings = {}) {
  const canvas = document.createElement("canvas");
  const fixedSize = getFixedOutputSize(settings);
  const shouldCrop = fixedSize.width > 0 && fixedSize.height > 0;
  canvas.width = shouldCrop ? fixedSize.width : width;
  canvas.height = shouldCrop ? fixedSize.height : height;
  const context = canvas.getContext("2d", { alpha: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  if (shouldCrop) {
    const x = (canvas.width - width) / 2;
    const y = (canvas.height - height) / 2;
    context.drawImage(bitmap, x, y, width, height);
  } else {
    context.drawImage(bitmap, 0, 0, width, height);
  }

  return canvas;
}

function getFixedOutputSize(settings) {
  if (settings.customFit === "cover" && settings.customWidth > 0 && settings.customHeight > 0) {
    return { width: settings.customWidth, height: settings.customHeight };
  }

  if (settings.maxWidth > 0 && settings.maxHeight > 0) {
    return { width: settings.maxWidth, height: settings.maxHeight };
  }

  return { width: 0, height: 0 };
}

function shouldUseFixedResolution(settings) {
  const fixedSize = getFixedOutputSize(settings);
  return fixedSize.width > 0 && fixedSize.height > 0;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob && blob.size > 0) {
          resolve(blob);
        } else {
          reject(new Error("画像の書き出しに失敗しました。"));
        }
      },
      type,
      quality,
    );
  });
}

async function createZip(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const centralDirectory = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const data = new Uint8Array(await file.blob.arrayBuffer());
    const crc = crc32(data);
    const localHeader = createZipHeader({
      signature: 0x04034b50,
      crc,
      size: data.length,
      nameBytes,
    });

    chunks.push(localHeader, nameBytes, data);
    centralDirectory.push({
      crc,
      size: data.length,
      nameBytes,
      offset,
    });
    offset += localHeader.length + nameBytes.length + data.length;
  }

  const centralStart = offset;

  for (const item of centralDirectory) {
    const centralHeader = createZipHeader({
      signature: 0x02014b50,
      crc: item.crc,
      size: item.size,
      nameBytes: item.nameBytes,
      offset: item.offset,
      central: true,
    });
    chunks.push(centralHeader, item.nameBytes);
    offset += centralHeader.length + item.nameBytes.length;
  }

  chunks.push(createEndOfCentralDirectory(files.length, offset - centralStart, centralStart));

  return new Blob(chunks, { type: "application/zip" });
}

function createZipHeader({ signature, crc, size, nameBytes, offset = 0, central = false }) {
  const header = new Uint8Array(central ? 46 : 30);
  const view = new DataView(header.buffer);
  view.setUint32(0, signature, true);

  if (central) {
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint16(14, 0, true);
    view.setUint32(16, crc, true);
    view.setUint32(20, size, true);
    view.setUint32(24, size, true);
    view.setUint16(28, nameBytes.length, true);
    view.setUint32(42, offset, true);
  } else {
    view.setUint16(4, 20, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, size, true);
    view.setUint32(22, size, true);
    view.setUint16(26, nameBytes.length, true);
  }

  return header;
}

function createEndOfCentralDirectory(fileCount, centralSize, centralOffset) {
  const header = new Uint8Array(22);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, fileCount, true);
  view.setUint16(10, fileCount, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  return header;
}

function crc32(data) {
  let crc = 0xffffffff;

  for (let index = 0; index < data.length; index += 1) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ data[index]) & 0xff];
  }

  return (crc ^ 0xffffffff) >>> 0;
}

const crcTable = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
})();

function makeOutputName(fileName, extension) {
  const baseName = fileName.replace(/\.[^.]+$/, "");
  return `${baseName}-discord-10mb.${extension}`;
}

function extensionFor(type) {
  if (type === "image/webp") return "webp";
  if (type === "image/png") return "png";
  return "jpg";
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)}${units[unitIndex]}`;
}

function formatSavedRatio(originalBytes, outputBytes) {
  const saved = Math.max(0, (1 - outputBytes / originalBytes) * 100);

  if (saved > 99 && saved < 100) {
    return `${saved.toFixed(2)}%`;
  }

  return `${Math.round(saved)}%`;
}

function updateEmptyState() {
  emptyState.hidden = results.children.length > 0;
  clearButton.disabled = results.children.length === 0;
  downloadAllButton.disabled = !records.some((record) => record.blob && record.blob.size > 0);
}

function updateRecordNumbers() {
  records.forEach((record, index) => {
    const number = record.node.querySelector(".thumb-number");
    number.textContent = String(index + 1).padStart(2, "0");
  });
}
