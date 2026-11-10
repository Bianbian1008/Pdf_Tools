"use strict";

const { PDFDocument, degrees } = PDFLib;
const $ = (id) => document.getElementById(id);
const sources = [];
let pages = [];
let draggedPage;
const papers = {
  a4: [210, 297], a5: [148, 210], a3: [297, 420],
  letter: [215.9, 279.4], legal: [215.9, 355.6],
};
const pointsPerMm = 72 / 25.4;
const maxSelectedPages = 20000;
let importing = false;
let exporting = false;
const supportsSavePicker = typeof window.showSaveFilePicker === "function";
const outputDate = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
});
let nextSourceOrder = 0;
let noticeTimer;

function parsePages(value, total, allowBlank = true) {
  const text = value.normalize("NFKC").trim().replace(/[、，]/g, ",").replace(/[–—−]/g, "-");
  if (!text && allowBlank) return Array.from({ length: total }, (_, index) => index);
  const pages = [];
  for (const token of text.split(",")) {
    const match = token.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) throw new Error("請輸入頁碼或範圍，例如 1-3, 7, 5。");
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (Math.min(start, end) < 1 || Math.max(start, end) > total) {
      throw new Error(`頁碼須介於 1 到 ${total}。`);
    }
    const count = Math.abs(end - start) + 1;
    if (pages.length + count > maxSelectedPages) throw new Error("單一選頁欄位最多可選 20,000 頁。");
    const direction = start <= end ? 1 : -1;
    for (let offset = 0; offset < count; offset++) pages.push(start + offset * direction - 1);
  }
  return pages;
}

function message(element, text, error = false) {
  element.textContent = text;
  element.classList.toggle("error", error);
}

function button(text, label, action) {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = text;
  element.setAttribute("aria-label", label);
  element.title = label;
  element.addEventListener("click", action);
  return element;
}

function previewAsset(name) {
  const encoded = window.pdfPreviewAssets[name];
  if (!encoded) throw new Error(`找不到預覽資源 ${name}`);
  return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
}

class PreviewBinaryData {
  async fetch({ filename }) {
    return previewAsset(filename);
  }
}

function loadPreview(bytes) {
  return pdfjsLib.getDocument({
    data: bytes, isEvalSupported: false, useWorkerFetch: false,
    BinaryDataFactory: PreviewBinaryData,
  });
}

const thumbnails = new IntersectionObserver((entries) => {
  for (const { target, isIntersecting } of entries) {
    if (!isIntersecting) continue;
    thumbnails.unobserve(target);
    drawThumbnail(target);
  }
}, { rootMargin: "240px" });

async function drawThumbnail(target) {
  const { source, index } = target.pageEntry;
  try {
    const preview = await source.preview.promise;
    const page = await preview.getPage(index + 1);
    await renderPreviewPage(page, target, 380, 480);
  } catch (error) {
    target.textContent = "無法顯示縮圖";
    if (target.isConnected) console.warn(error);
  }
}

async function renderPreviewPage(page, target, maxWidth, maxHeight, intent = "display") {
  const size = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(maxWidth / size.width, maxHeight / size.height) });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: canvas.getContext("2d"), viewport, intent }).promise;
  const image = target.ownerDocument.createElement("img");
  image.alt = "";
  image.src = canvas.toDataURL();
  target.replaceChildren(image);
}

function movePage(entry, destination) {
  const index = pages.indexOf(entry);
  if (index === destination) return;
  pages.splice(index, 1);
  pages.splice(destination, 0, entry);
  renderPages();
  entry.checkbox.focus({ preventScroll: true });
}

function createPageCard(entry) {
  const { source, index } = entry;
  const title = `${source.name} 第 ${index + 1} 頁`;
  const card = document.createElement("li");
  card.className = "page-card";
  const pick = document.createElement("label");
  pick.className = "page-pick";
  entry.checkbox = document.createElement("input");
  entry.checkbox.type = "checkbox";
  entry.checkbox.setAttribute("aria-label", `匯出 ${title}`);
  entry.position = document.createElement("span");
  pick.append(entry.checkbox, entry.position);
  entry.checkbox.addEventListener("change", () => {
    entry.selected = entry.checkbox.checked;
    card.classList.toggle("excluded", !entry.selected);
    update();
  });
  const thumbnail = document.createElement("div");
  thumbnail.className = "thumbnail";
  thumbnail.draggable = true;
  thumbnail.pageEntry = entry;
  thumbnail.textContent = "載入縮圖…";
  thumbnail.addEventListener("dragstart", (event) => {
    draggedPage = entry;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", title);
  });
  thumbnail.addEventListener("dragend", () => { draggedPage = undefined; });
  const before = (event) => {
    const bounds = card.getBoundingClientRect();
    return event.clientX < bounds.left + bounds.width / 2;
  };
  const clearDrop = () => card.classList.remove("drop-before", "drop-after");
  card.addEventListener("dragover", (event) => {
    if (!draggedPage || draggedPage === entry) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const insertBefore = before(event);
    card.classList.toggle("drop-before", insertBefore);
    card.classList.toggle("drop-after", !insertBefore);
  });
  card.addEventListener("dragleave", (event) => {
    if (!card.contains(event.relatedTarget)) clearDrop();
  });
  card.addEventListener("drop", (event) => {
    clearDrop();
    if (!draggedPage || draggedPage === entry) return;
    event.preventDefault();
    const target = pages.indexOf(entry) + (before(event) ? 0 : 1);
    const from = pages.indexOf(draggedPage);
    movePage(draggedPage, target - (from < target ? 1 : 0));
    draggedPage = undefined;
  });
  const caption = document.createElement("div");
  caption.className = "page-caption";
  caption.title = title;
  const filename = document.createElement("span");
  filename.className = "page-filename";
  filename.textContent = source.name;
  const pageNumber = document.createElement("span");
  pageNumber.textContent = `原始第 ${index + 1} 頁`;
  caption.append(filename, pageNumber);
  const actions = document.createElement("div");
  actions.className = "page-actions";
  entry.previous = button("←", `將 ${title} 往前移一位`, () => movePage(entry, pages.indexOf(entry) - 1));
  entry.next = button("→", `將 ${title} 往後移一位`, () => movePage(entry, pages.indexOf(entry) + 1));
  actions.append(entry.previous, entry.next);
  card.append(pick, thumbnail, caption, actions);
  thumbnails.observe(thumbnail);
  return card;
}

function renderPages() {
  const list = $("pages");
  const fragment = document.createDocumentFragment();
  pages.forEach((entry, position) => {
    entry.card ??= createPageCard(entry);
    entry.checkbox.checked = entry.selected;
    entry.card.classList.toggle("excluded", !entry.selected);
    entry.position.textContent = `第 ${position + 1} 頁`;
    entry.previous.disabled = position === 0;
    entry.next.disabled = position === pages.length - 1;
    fragment.append(entry.card);
  });
  for (const card of list.children) thumbnails.unobserve(card.querySelector(".thumbnail"));
  list.replaceChildren(fragment);
  update();
}

function applySourceSelection(source, selection) {
  const available = pages.filter((entry) => entry.source === source);
  const byIndex = new Map();
  for (const entry of available) {
    if (!byIndex.has(entry.index)) byIndex.set(entry.index, []);
    byIndex.get(entry.index).push(entry);
  }
  const selected = selection.map((index) => {
    const entry = byIndex.get(index)?.shift() ?? { source, index };
    entry.selected = true;
    return entry;
  });
  const remaining = [...byIndex.values()].flat();
  for (const entry of remaining) entry.selected = false;
  const reordered = selected.concat(remaining);
  let position = 0;
  pages = pages.flatMap((entry) => {
    if (entry.source !== source) return entry;
    position++;
    return position === available.length ? reordered.slice(position - 1) : reordered[position - 1];
  });
  renderPages();
}

function renderSources() {
  $("empty").hidden = sources.length > 0;
  $("preview").hidden = sources.length === 0;
  $("drop").hidden = sources.length > 0;
  $("sources").replaceChildren(...sources.map((source, index) => {
    const row = document.createElement("li");
    row.className = "source";
    const header = document.createElement("div");
    header.className = "source-head";
    const info = document.createElement("div");
    const name = document.createElement("strong");
    name.className = "source-name";
    name.textContent = `${index + 1}. ${source.name}`;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `共 ${source.total} 頁`;
    info.append(name, meta);
    const actions = document.createElement("div");
    actions.className = "source-actions";
    const move = (offset) => {
      const destination = index + offset;
      [sources[index], sources[destination]] = [sources[destination], sources[index]];
      const grouped = new Map(sources.map((item) => [item, []]));
      for (const entry of pages) grouped.get(entry.source).push(entry);
      pages = sources.flatMap((item) => grouped.get(item));
      renderSources();
      renderPages();
      $("sources").children[destination].querySelector("input").focus();
    };
    const up = button("↑", "往上移並依檔案重新排列所有頁面", () => move(-1));
    const down = button("↓", "往下移並依檔案重新排列所有頁面", () => move(1));
    up.disabled = index === 0;
    down.disabled = index === sources.length - 1;
    const remove = button("移除", `移除 ${source.name}`, () => {
      sources.splice(index, 1);
      pages = pages.filter((entry) => entry.source !== source);
      source.preview.destroy().catch(() => {});
      renderSources();
      renderPages();
      ($("sources").children[Math.min(index, sources.length - 1)]?.querySelector("input") ?? $("drop")).focus();
    });
    actions.append(up, down, remove);
    header.append(info, actions);
    const label = document.createElement("label");
    label.textContent = "選取頁碼";
    const input = document.createElement("input");
    input.type = "text";
    input.value = source.selection;
    input.placeholder = "全部頁面";
    const feedback = document.createElement("span");
    feedback.className = "hint";
    feedback.id = `selection-${index}`;
    input.setAttribute("aria-describedby", `page-help ${feedback.id}`);
    const apply = () => {
      try {
        const selection = parsePages(input.value, source.total);
        source.selection = input.value;
        applySourceSelection(source, selection);
        input.removeAttribute("aria-invalid");
        message(feedback, `已套用 ${selection.length} 頁`);
      } catch (error) {
        input.setAttribute("aria-invalid", "true");
        message(feedback, error.message, true);
      }
    };
    input.addEventListener("input", () => {
      input.removeAttribute("aria-invalid");
      message(feedback, "");
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") apply();
    });
    label.append(input, feedback);
    const applyButton = button("套用", `套用 ${source.name} 的選取頁碼`, apply);
    applyButton.className = "apply-pages";
    row.append(header, label, applyButton);
    return row;
  }));
  update();
}

async function runPdfProtection(bytes, options) {
  let invalidPassword = false;
  const qpdf = await Module({
    noInitialRun: true,
    wasmBinary: Uint8Array.from(atob(qpdfBinary), (character) => character.charCodeAt(0)),
    print() {},
    printErr(line) { invalidPassword ||= /invalid password/i.test(line); },
  });
  qpdf.FS.writeFile("/input.pdf", bytes);
  try {
    const result = qpdf.callMain([...options, "/input.pdf", "/output.pdf"]);
    if (invalidPassword) return null;
    // qpdf exit code 3 means it wrote the file with warnings.
    if (result !== 0 && result !== 3) throw new Error("PDF 密碼處理失敗。");
    return qpdf.FS.readFile("/output.pdf");
  } finally {
    qpdf.FS.unlink("/input.pdf");
    try { qpdf.FS.unlink("/output.pdf"); } catch { /* No output on failure. */ }
  }
}

async function unlockPdf(bytes, filename) {
  const dialog = $("unlock-dialog");
  const input = $("unlock-password");
  $("unlock-filename").textContent = filename;
  message($("unlock-status"), "");
  while (true) {
    dialog.returnValue = "skip";
    const closed = new Promise((resolve) => dialog.addEventListener("close", resolve, { once: true }));
    dialog.showModal();
    await closed;
    const password = input.value;
    input.value = "";
    if (dialog.returnValue !== "unlock") return null;
    const unlocked = await runPdfProtection(bytes, [`--password=${password}`, "--decrypt"]);
    if (unlocked) return unlocked;
    message($("unlock-status"), "密碼不正確，請再試一次。", true);
  }
}

async function importFiles(files) {
  if (!files.length || importing || exporting) return;
  importing = true;
  $("files").disabled = true;
  update();
  message($("import-status"), "正在讀取 PDF…");
  const errors = [];
  let added = 0;
  for (const file of files) {
    try {
      let data = new Uint8Array(await file.arrayBuffer());
      let doc = await PDFDocument.load(data, { updateMetadata: false, ignoreEncryption: true });
      let unlocked = false;
      if (doc.isEncrypted) {
        data = await unlockPdf(data, file.name);
        if (!data) {
          errors.push(`${file.name}：已跳過加密的 PDF。`);
          continue;
        }
        unlocked = true;
        doc = await PDFDocument.load(data, { updateMetadata: false });
      }
      const total = doc.getPageCount();
      if (!total) {
        errors.push(`${file.name}：沒有可用頁面。`);
        continue;
      }
      const preview = loadPreview(data.slice());
      preview.promise.catch(() => {});
      const source = {
        name: file.name, doc, total, selection: "", preview, importOrder: nextSourceOrder++,
        original: unlocked ? new Blob([data]) : file, unlocked,
      };
      sources.push(source);
      for (let index = 0; index < total; index++) pages.push({ source, index, selected: true });
      added++;
    } catch (error) {
      const reason = "無法讀取或解鎖，請確認檔案是有效且受支援的 PDF。";
      errors.push(`${file.name}：${reason}`);
    }
  }
  importing = false;
  $("files").disabled = false;
  $("files").value = "";
  message($("import-status"), [added ? `已加入 ${added} 份 PDF。` : "", ...errors].filter(Boolean).join("\n"), errors.length > 0);
  renderSources();
  renderPages();
  if (added && document.activeElement === document.body) $("add-files").focus({ preventScroll: true });
}

function planOutput() {
  const mode = $("mode").value;
  const all = pages.filter((entry) => entry.selected);
  if (!all.length) throw new Error("請至少勾選一頁。");
  let groups = [all];
  if (mode === "source") {
    const grouped = new Map();
    for (const entry of all) {
      if (!grouped.has(entry.source)) grouped.set(entry.source, []);
      grouped.get(entry.source).push(entry);
    }
    groups = [...grouped.values()];
  }
  if (mode === "chunk") {
    const size = $("chunk").valueAsNumber;
    if (!Number.isSafeInteger(size) || size < 1) throw new Error("每份頁數須為正整數。");
    groups = [];
    for (let start = 0; start < all.length; start += size) groups.push(all.slice(start, start + size));
  }
  if (mode === "custom") {
    groups = $("groups").value.normalize("NFKC").split(";").map((range, index) => {
      try {
        return parsePages(range, all.length, false).map((page) => all[page]);
      } catch (error) {
        throw new Error(`第 ${index + 1} 組：${error.message}`);
      }
    });
  }

  if (!$("reformat").checked) return { groups, mode, nup: 1 };
  const margin = $("margin").valueAsNumber * pointsPerMm;
  if (!Number.isFinite(margin) || margin < 0 || margin > 60 * pointsPerMm) {
    throw new Error("邊界須介於 0 到 60 mm。");
  }
  const landscape = $("orientation").value === "landscape";
  const [short, long] = papers[$("paper").value].map((mm) => mm * pointsPerMm);
  return {
    groups, mode, margin, landscape,
    width: landscape ? long : short,
    height: landscape ? short : long,
    nup: Number($("nup").value),
    shrink: $("scaling").value === "shrink",
  };
}

function update() {
  const busy = importing || exporting;
  $("drop").disabled = busy;
  $("add-files").disabled = busy;
  const checked = pages.filter((entry) => entry.selected).length;
  $("page-count").textContent = `已勾選 ${checked} / ${pages.length} 頁`;
  $("select-all").disabled = checked === pages.length;
  $("select-none").disabled = checked === 0;
  $("chunk-settings").hidden = $("mode").value !== "chunk";
  $("custom-settings").hidden = $("mode").value !== "custom";
  const reformat = $("reformat").checked;
  $("layout-settings").hidden = !reformat;
  $("layout-settings").disabled = !reformat;
  const lock = $("lock-output").checked;
  $("output-password-settings").hidden = !lock;
  $("output-password").disabled = !lock;
  $("export").textContent = $("mode").value === "merge" ? "下載 PDF" : "下載分割結果";
  $("export").disabled = true;
  $("save-as").disabled = true;
  $("filename").placeholder = sources.length ? defaultOutputName() : "日期_第一份檔名";
  $("preview-output").disabled = true;
  if (!sources.length) return message($("summary"), "加入 PDF 後即可設定輸出。");
  try {
    const { groups, nup } = planOutput();
    const selected = groups.reduce((count, group) => count + group.length, 0);
    const sheets = groups.reduce((count, group) => count + Math.ceil(group.length / nup), 0);
    message($("summary"), `取用 ${selected} 頁 · 輸出 ${groups.length} 份 PDF · 共 ${sheets} 張 · ${reformat ? "自訂列印版面" : "原樣輸出"}`);
    $("export").disabled = busy;
    $("save-as").disabled = $("export").disabled || !supportsSavePicker;
    $("preview-output").disabled = $("export").disabled;
    if (lock && !validOutputPassword($("output-password").value)) {
      $("export").disabled = true;
      $("save-as").disabled = true;
      message($("summary"), "請輸入開啟密碼（最多 127 個 UTF-8 位元組）。", true);
    }
  } catch (error) {
    message($("summary"), error.message, true);
  }
}

async function copyOriginal(output, group) {
  const positions = new Map();
  group.forEach(({ source, index }, position) => {
    if (!positions.has(source)) positions.set(source, []);
    positions.get(source).push({ index, position });
  });
  const pages = new Array(group.length);
  for (const [source, entries] of positions) {
    const copies = await output.copyPages(source.doc, entries.map(({ index }) => index));
    entries.forEach(({ position }, index) => { pages[position] = copies[index]; });
  }
  for (const page of pages) output.addPage(page);
}

async function layOutPages(output, group, layout) {
  const { width, height, margin, nup, landscape, shrink } = layout;
  const cols = nup === 4 || (nup === 2 && landscape) ? 2 : 1;
  const rows = nup / cols;
  const gap = Math.min(margin, 4 * pointsPerMm);
  const cellWidth = (width - 2 * margin - (cols - 1) * gap) / cols;
  const cellHeight = (height - 2 * margin - (rows - 1) * gap) / rows;
  let sheet;
  for (const [position, { source, index }] of group.entries()) {
    const slot = position % nup;
    if (slot === 0) sheet = output.addPage([width, height]);
    const page = source.doc.getPage(index);
    if (!page.node.Contents()) continue;
    const crop = page.getCropBox();
    const media = page.getMediaBox();
    const left = Math.max(crop.x, media.x);
    const bottom = Math.max(crop.y, media.y);
    const right = Math.min(crop.x + crop.width, media.x + media.width);
    const top = Math.min(crop.y + crop.height, media.y + media.height);
    if (right <= left || top <= bottom) throw new Error(`${source.name} 的第 ${index + 1} 頁沒有有效的可列印範圍。`);

    const embedded = await output.embedPage(page, { left, bottom, right, top });
    const rotation = ((page.getRotation().angle % 360) + 360) % 360;
    const sideways = rotation === 90 || rotation === 270;
    const visualWidth = sideways ? embedded.height : embedded.width;
    const visualHeight = sideways ? embedded.width : embedded.height;
    const fit = Math.min(cellWidth / visualWidth, cellHeight / visualHeight);
    const scale = shrink ? Math.min(1, fit) : fit;
    const col = slot % cols;
    const row = Math.floor(slot / cols);
    let x = margin + col * (cellWidth + gap) + (cellWidth - visualWidth * scale) / 2;
    let y = height - margin - row * (cellHeight + gap) - (cellHeight + visualHeight * scale) / 2;
    if (rotation === 180 || rotation === 270) x += visualWidth * scale;
    if (rotation === 90 || rotation === 180) y += visualHeight * scale;
    sheet.drawPage(embedded, { x, y, xScale: scale, yScale: scale, rotate: degrees(-rotation) });
  }
}

async function createPdf(group, layout) {
  const output = await PDFDocument.create();
  if (layout.width) await layOutPages(output, group, layout);
  else await copyOriginal(output, group);
  return output.save();
}

function validOutputPassword(password) {
  return Boolean(password.trim()) && !password.includes("\0") && new TextEncoder().encode(password).length <= 127;
}

async function createExportPdf(group, plan, password) {
  const { source } = group[0];
  const wholeFile = !plan.width && group.length === source.total &&
    group.every((entry, index) => entry.source === source && entry.index === index);
  const bytes = wholeFile && (password || source.unlocked)
    ? new Uint8Array(await source.original.arrayBuffer())
    : await createPdf(group, plan);
  if (!password) return bytes;
  const owner = Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const encrypted = await runPdfProtection(bytes, [
    "--encrypt", `--user-password=${password}`, `--owner-password=${owner}`, "--bits=256", "--",
  ]);
  if (!encrypted) throw new Error("無法設定 PDF 開啟密碼。");
  return encrypted;
}

async function showOutputPreview(popup, plan) {
  const doc = popup.document;
  doc.documentElement.lang = "zh-Hant";
  doc.documentElement.dataset.theme = document.documentElement.dataset.theme;
  doc.title = "PDF 輸出預覽";
  const stylesheet = doc.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = new URL("style.css", document.baseURI).href;
  doc.head.append(stylesheet);
  const viewport = doc.createElement("meta");
  viewport.name = "viewport";
  viewport.content = "width=device-width, initial-scale=1";
  doc.head.append(viewport);
  const content = doc.createElement("main");
  content.className = "output-preview";
  const title = doc.createElement("h1");
  title.textContent = "PDF 輸出預覽";
  const status = doc.createElement("p");
  status.className = "hint";
  status.setAttribute("role", "status");
  status.textContent = "正在產生預覽…";
  content.append(title, status);
  doc.body.append(content);

  const tasks = [];
  let closed = false;
  const observer = new popup.IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      if (!isIntersecting) continue;
      observer.unobserve(target);
      const { pdf, pageNumber } = target.preview;
      pdf.getPage(pageNumber).then((page) => renderPreviewPage(page, target, 1200, 1600, "print")).catch(() => {
        if (!closed) target.textContent = "無法顯示這一頁。";
      });
    }
  }, { rootMargin: "250px" });
  popup.addEventListener("pagehide", () => {
    closed = true;
    observer.disconnect();
    for (const task of tasks) task.destroy().catch(() => {});
  }, { once: true });

  try {
    for (const [index, group] of plan.groups.entries()) {
      if (closed || popup.closed) return;
      status.textContent = `正在準備第 ${index + 1} / ${plan.groups.length} 份 PDF…`;
      const bytes = await createPdf(group, plan);
      if (closed || popup.closed) return;
      const task = loadPreview(bytes);
      tasks.push(task);
      const pdf = await task.promise;
      if (closed || popup.closed) return;
      const section = doc.createElement("section");
      const heading = doc.createElement("h2");
      heading.textContent = `第 ${index + 1} 份 PDF · ${pdf.numPages} 頁`;
      section.append(heading);
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const figure = doc.createElement("figure");
        const label = doc.createElement("figcaption");
        label.textContent = `輸出第 ${pageNumber} 頁`;
        const sheet = doc.createElement("div");
        sheet.className = "preview-sheet";
        sheet.textContent = "載入頁面…";
        sheet.preview = { pdf, pageNumber };
        figure.append(label, sheet);
        section.append(figure);
        observer.observe(sheet);
      }
      content.append(section);
    }
    status.textContent = `共 ${plan.groups.length} 份 PDF · ${plan.width ? "自訂列印版面" : "原樣輸出"}。這是開啟時的設定，修改後請重新預覽。`;
  } catch (error) {
    if (closed || popup.closed) return;
    console.error(error);
    message(status, "預覽產生失敗，請關閉此視窗後重試。", true);
  }
}

function saveDownload(bytes, filename, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function writeOutput(file, bytes) {
  const writer = await file.createWritable();
  try {
    await writer.write(bytes);
    await writer.close();
  } catch (error) {
    await writer.abort().catch(() => {});
    throw error;
  }
}

function baseName(value) {
  const name = value.trim().replace(/\.(pdf|zip)$/i, "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/, "");
  return name || "PDF 輸出";
}

function defaultOutputName() {
  const first = sources.reduce((earliest, source) => source.importOrder < earliest.importOrder ? source : earliest);
  const stem = Array.from(baseName(first.name)).slice(0, 115).join("");
  return `${outputDate.format(new Date())}_${stem}`;
}

function notifyExport(text) {
  message($("export-status"), text);
  const notice = $("export-notice");
  notice.textContent = text;
  notice.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.hidden = true; }, 6500);
}

$("files").addEventListener("change", (event) => importFiles(Array.from(event.target.files)));
for (const id of ["drop", "add-files"]) {
  $(id).addEventListener("click", () => $("files").click());
}

function setTheme(theme) {
  const mode = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = mode;
  $("theme").value = mode;
}

try {
  setTheme(localStorage.getItem("pdf-workbench-theme"));
} catch {
  setTheme("light");
}
$("theme").addEventListener("change", () => {
  const mode = $("theme").value;
  setTheme(mode);
  try {
    localStorage.setItem("pdf-workbench-theme", mode);
  } catch {
    // Some browsers block local storage for local files.
  }
});
for (const [id, selected] of [["select-all", true], ["select-none", false]]) {
  $(id).addEventListener("click", () => {
    for (const entry of pages) entry.selected = selected;
    renderPages();
  });
}
for (const type of ["dragenter", "dragover"]) {
  $("drop").addEventListener(type, (event) => {
    event.preventDefault();
    $("drop").classList.add("active");
  });
}
$("drop").addEventListener("dragleave", () => $("drop").classList.remove("active"));
$("drop").addEventListener("drop", (event) => {
  event.preventDefault();
  $("drop").classList.remove("active");
  importFiles(Array.from(event.dataTransfer.files));
});
if (!supportsSavePicker) $("save-as").title = "請使用支援另存新檔的 Edge 或 Chrome。";
$("output").addEventListener("input", update);
$("lock-output").addEventListener("change", () => {
  if (!$("lock-output").checked) $("output-password").value = "";
});
$("unlock-dialog").querySelector("form").addEventListener("submit", (event) => {
  event.preventDefault();
  $("unlock-dialog").close("unlock");
});
$("skip-unlock").addEventListener("click", () => $("unlock-dialog").close("skip"));
$("preview-output").addEventListener("click", () => {
  if ($("preview-output").disabled) return;
  const plan = planOutput();
  const popup = window.open("", "_blank");
  if (!popup) {
    message($("export-status"), "瀏覽器已阻擋預覽分頁，請允許開啟新分頁後再試。", true);
    return;
  }
  message($("export-status"), "");
  showOutputPreview(popup, plan);
});
$("output").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!$("export").disabled) exportOutput(false);
});
$("save-as").addEventListener("click", () => {
  if (!$("save-as").disabled) exportOutput(true);
});

async function exportOutput(saveAs) {
  const plan = planOutput();
  const password = $("lock-output").checked ? $("output-password").value : "";
  const name = $("filename").value.trim() ? baseName($("filename").value) : defaultOutputName();
  const extension = plan.groups.length === 1 ? "pdf" : "zip";
  const type = extension === "pdf" ? "application/pdf" : "application/zip";
  $("export-notice").hidden = true;
  exporting = true;
  $("files").disabled = true;
  update();
  try {
    let file;
    if (saveAs) {
      try {
        file = await window.showSaveFilePicker({
          suggestedName: `${name}.${extension}`,
          types: [{ description: extension === "pdf" ? "PDF 文件" : "ZIP 壓縮檔", accept: { [type]: [`.${extension}`] } }],
        });
      } catch (error) {
        if (error.name !== "AbortError") message($("export-status"), "無法開啟另存新檔視窗，請重試。", true);
        return;
      }
    }
    const files = Object.create(null);
    const digits = String(plan.groups.length).length;
    let singlePdf;
    for (const [index, group] of plan.groups.entries()) {
      message($("export-status"), `正在產生第 ${index + 1} / ${plan.groups.length} 份 PDF…`);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const bytes = await createExportPdf(group, plan, password);
      if (plan.groups.length === 1) singlePdf = bytes;
      else {
        const suffix = String(index + 1).padStart(digits, "0");
        files[`${name}_${suffix}.pdf`] = bytes;
      }
    }
    const bytes = singlePdf ?? fflate.zipSync(files, { level: 0 });
    if (file) {
      try {
        await writeOutput(file, bytes);
        notifyExport(`已儲存：${file.name}`);
      } catch (error) {
        console.error(error);
        message($("export-status"), "無法寫入檔案，請重新選擇儲存位置後再匯出。", true);
      }
    } else {
      saveDownload(bytes, `${name}.${extension}`, type);
      notifyExport(`已交給瀏覽器下載：${name}.${extension}`);
    }
  } catch (error) {
    console.error(error);
    message($("export-status"), `匯出失敗。請確認來源 PDF 可正常開啟。\n${error.message}`, true);
  } finally {
    exporting = false;
    $("files").disabled = false;
    update();
  }
}
update();
