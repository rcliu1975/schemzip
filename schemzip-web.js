const PROGRAM_VERSION = "0.1.0";
const SCHEMA_VERSION = 1;
const DEFAULT_OWNER = "rcliu1975";
const DEFAULT_REPO = "schemzip";
const DEFAULT_EMBED_URL = "https://embed.diagrams.net/?embed=1&proto=json&ui=atlas&spin=1&lang=en";
const RAW_DRAWIO_SCHEMA = "schemzip.drawio-xml";

const templateCache = new Map();
const embeddedOrigins = new Set(["https://embed.diagrams.net"]);

function getLocalStorage() {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function templateCacheKey(url) {
  return `schemzip.template-db::${url}`;
}

function readCachedJson(url) {
  const storage = getLocalStorage();
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(templateCacheKey(url));
    if (!raw) {
      return null;
    }
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeCachedJson(url, data) {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(templateCacheKey(url), JSON.stringify(data));
  } catch {
    // Ignore quota and security errors; the live fetch still succeeds.
  }
}

function decodeBase64Url(token) {
  const padded = token + "=".repeat((4 - (token.length % 4)) % 4);
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function encodeBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function decompressGzip(bytes) {
  if ("DecompressionStream" in globalThis) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    const arrayBuffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }
  throw new Error("gzip decompression is not available in this browser");
}

async function compressGzip(bytes) {
  if ("CompressionStream" in globalThis) {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
    const arrayBuffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }
  throw new Error("gzip compression is not available in this browser");
}

async function decodePayloadJson(token) {
  const compressed = decodeBase64Url(token);
  const raw = await decompressGzip(compressed);
  return JSON.parse(new TextDecoder().decode(raw));
}

async function encodePayloadJson(payload) {
  const raw = new TextEncoder().encode(JSON.stringify(payload));
  const compressed = await compressGzip(raw);
  return encodeBase64Url(compressed);
}

function buildShareUrl(baseUrl, params) {
  const fallbackBase = typeof window !== "undefined" ? window.location.href : "https://schemzip.invalid/";
  const url = new URL(baseUrl, fallbackBase);
  url.hash = new URLSearchParams(Object.entries(params)).toString();
  return url.toString();
}

function buildBookmarkUrl(baseUrl, params) {
  const fallbackBase = typeof window !== "undefined" ? window.location.href : "https://schemzip.invalid/";
  const url = new URL(baseUrl, fallbackBase);
  url.search = "";
  url.hash = "";
  if (params.lib != null && params.lib !== "") {
    url.searchParams.set("lib", params.lib);
  }
  if (params.ver != null && params.ver !== "") {
    url.searchParams.set("ver", params.ver);
  }
  const fragment = new URLSearchParams();
  fragment.set("v", String(params.v || SCHEMA_VERSION));
  if (params.sha != null && params.sha !== "") {
    fragment.set("sha", params.sha);
  }
  if (params.data != null && params.data !== "") {
    fragment.set("data", params.data);
  }
  url.hash = fragment.toString();
  return url.toString();
}

function stripFileExtension(filename) {
  return String(filename || "diagram").replace(/\.[^.]+$/, "");
}

function formatEnglishDateTime(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(date);
}

function updateDocumentTitle(filename, date = new Date()) {
  const baseName = stripFileExtension(filename);
  document.title = `Drawio: ${baseName} - ${formatEnglishDateTime(date)}`;
}

function buildDrawioUploadPayload(xml, sourceFile) {
  return {
    schema: RAW_DRAWIO_SCHEMA,
    schema_version: SCHEMA_VERSION,
    program_version: PROGRAM_VERSION,
    source_file: sourceFile,
    created_at: new Date().toISOString(),
    xml,
  };
}

function parseCompactFragment(fragment) {
  const match = fragment.match(/^(?<lib>[^@:#?]+)@(?<ver>[^:#?]+):(?<data>[^#?]+)$/);
  if (!match || !match.groups) {
    throw new Error("unsupported share fragment format");
  }
  return {
    v: String(SCHEMA_VERSION),
    lib: match.groups.lib,
    ver: match.groups.ver,
    data: match.groups.data,
  };
}

function parseFragment(fragment) {
  const value = fragment.replace(/^#/, "").trim();
  if (!value) {
    throw new Error("empty share fragment");
  }
  if (value.includes("=")) {
    return Object.fromEntries(new URLSearchParams(value).entries());
  }
  return parseCompactFragment(value);
}

function parseBookmarkLocation(source = typeof window !== "undefined" ? window.location.href : "https://schemzip.invalid/") {
  const fallbackBase = typeof window !== "undefined" ? window.location.href : "https://schemzip.invalid/";
  const url = new URL(source, fallbackBase);
  const query = Object.fromEntries(url.searchParams.entries());
  const fragment = url.hash ? parseFragment(url.hash) : {};
  return {
    query,
    fragment,
    params: { ...query, ...fragment },
  };
}

function resolveLibraryUrl(params) {
  const owner = params.owner || DEFAULT_OWNER;
  const repo = params.repo || DEFAULT_REPO;
  const ver = params.ver;
  if (!ver) {
    throw new Error("bookmark is missing ver");
  }
  return `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ver)}/template_db.json`;
}

function resolveLibraryUrls(params) {
  const rawVersion = String(params.ver || "").trim();
  if (!rawVersion) {
    throw new Error("bookmark is missing ver");
  }
  const normalized = normalizeVersionToken(rawVersion);
  const candidates = [rawVersion];
  if (normalized && normalized !== rawVersion) {
    candidates.push(normalized);
  }
  const prefixed = `v${normalized}`;
  if (normalized && prefixed !== rawVersion && prefixed !== normalized) {
    candidates.push(prefixed);
  }
  return [...new Set(candidates)].map((ver) => resolveLibraryUrl({ ...params, ver }));
}

async function fetchJson(url) {
  const cached = templateCache.get(url);
  if (cached) {
    return cached;
  }
  const persisted = readCachedJson(url);
  if (persisted) {
    templateCache.set(url, persisted);
    return persisted;
  }
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) {
    if (persisted) {
      return persisted;
    }
    throw new Error(`failed to load ${url}: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  templateCache.set(url, data);
  writeCachedJson(url, data);
  return data;
}

function parseXmlDocument(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) {
    throw new Error(parserError.textContent || "invalid XML");
  }
  return doc;
}

function serializeXml(node) {
  return new XMLSerializer().serializeToString(node);
}

function getGeometry(cell) {
  return Array.from(cell.children).find((child) => child.tagName === "mxGeometry") || null;
}

function readNumber(value, fallback = 0) {
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeLibraryId(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeVersionToken(value) {
  return String(value || "").trim().replace(/^v/i, "");
}

function round6(value) {
  return Math.round(value * 1e6) / 1e6;
}

function scaleAttribute(element, name, scale) {
  const current = element.getAttribute(name);
  if (current == null) {
    return;
  }
  const numeric = Number.parseFloat(current);
  if (Number.isFinite(numeric)) {
    element.setAttribute(name, String(round6(numeric * scale)));
  }
}

function scaleGeometry(geom, scaleX, scaleY) {
  scaleAttribute(geom, "x", scaleX);
  scaleAttribute(geom, "y", scaleY);
  scaleAttribute(geom, "width", scaleX);
  scaleAttribute(geom, "height", scaleY);

  for (const point of geom.querySelectorAll("mxPoint")) {
    scaleAttribute(point, "x", scaleX);
    scaleAttribute(point, "y", scaleY);
  }
}

function buildGraphModel(page) {
  const graphAttrs = page.graph || {};
  const attrs = {
    dx: String(graphAttrs.dx ?? 0),
    dy: String(graphAttrs.dy ?? 0),
    grid: String(graphAttrs.grid ?? 1),
    gridSize: String(graphAttrs.gridSize ?? 10),
    guides: String(graphAttrs.guides ?? 1),
    tooltips: String(graphAttrs.tooltips ?? 1),
    connect: String(graphAttrs.connect ?? 0),
    arrows: String(graphAttrs.arrows ?? 0),
    fold: String(graphAttrs.fold ?? 1),
    page: String(graphAttrs.page ?? 0),
    pageScale: String(graphAttrs.pageScale ?? 1),
    pageWidth: String(graphAttrs.pageWidth ?? 827),
    pageHeight: String(graphAttrs.pageHeight ?? 1169),
    math: String(graphAttrs.math ?? 0),
    shadow: String(graphAttrs.shadow ?? 0),
  };
  const doc = document.implementation.createDocument("", "mxGraphModel", null);
  const graphModel = doc.documentElement;
  Object.entries(attrs).forEach(([key, value]) => graphModel.setAttribute(key, value));
  const root = doc.createElement("root");
  const cell0 = doc.createElement("mxCell");
  cell0.setAttribute("id", "0");
  root.appendChild(cell0);
  const cell1 = doc.createElement("mxCell");
  cell1.setAttribute("id", "1");
  cell1.setAttribute("parent", "0");
  root.appendChild(cell1);
  graphModel.appendChild(root);
  return doc;
}

function getSourceCells(doc) {
  const root = doc.getElementsByTagName("root")[0];
  if (!root) {
    return [];
  }
  return Array.from(root.getElementsByTagName("mxCell")).filter((cell) => !["0", "1"].includes(cell.getAttribute("id")));
}

function findGroupCell(cells) {
  return cells.find((cell) => cell.getAttribute("style") === "group" && cell.getAttribute("vertex") === "1") || null;
}

function expandTemplateItem(item, sourceXml, resultDoc) {
  const sourceDoc = parseXmlDocument(sourceXml);
  const root = sourceDoc.getElementsByTagName("root")[0];
  if (!root) {
    throw new Error("template xml missing root");
  }

  const cells = getSourceCells(sourceDoc);
  const groupCell = findGroupCell(cells);
  if (!groupCell) {
    throw new Error("template xml missing group cell");
  }
  const groupGeom = getGeometry(groupCell);
  if (!groupGeom) {
    throw new Error("template group missing geometry");
  }

  const templateWidth = readNumber(groupGeom.getAttribute("width"), 1);
  const templateHeight = readNumber(groupGeom.getAttribute("height"), 1);
  const placement = item.placement || {};
  const targetX = readNumber(placement.x, 0);
  const targetY = readNumber(placement.y, 0);
  const targetWidth = readNumber(placement.width, templateWidth);
  const targetHeight = readNumber(placement.height, templateHeight);
  const scaleX = templateWidth ? targetWidth / templateWidth : 1;
  const scaleY = templateHeight ? targetHeight / templateHeight : 1;

  const idMap = new Map([["0", "0"], ["1", "1"]]);
  for (const cell of cells) {
    const id = cell.getAttribute("id");
    if (id) {
      idMap.set(id, `${item.id_prefix}${id}`);
    }
  }

  const expanded = [];
  for (const cell of cells) {
    const cloned = resultDoc.importNode(cell, true);
    const id = cloned.getAttribute("id");
    if (id) {
      cloned.setAttribute("id", idMap.get(id) || id);
    }
    const parent = cloned.getAttribute("parent");
    if (parent && idMap.has(parent) && !["0", "1"].includes(parent)) {
      cloned.setAttribute("parent", idMap.get(parent));
    } else if (parent === "0") {
      cloned.setAttribute("parent", "1");
    }

    const geom = getGeometry(cloned);
    if (geom) {
      if (cell === groupCell) {
        geom.setAttribute("x", String(round6(targetX)));
        geom.setAttribute("y", String(round6(targetY)));
        geom.setAttribute("width", String(round6(targetWidth)));
        geom.setAttribute("height", String(round6(targetHeight)));
      } else {
        scaleGeometry(geom, scaleX, scaleY);
      }
    }
    expanded.push(cloned);
  }
  return expanded;
}

function literalCells(item, resultDoc) {
  return (item.cells || []).map((cellXml) => {
    const sourceDoc = parseXmlDocument(cellXml);
    return resultDoc.importNode(sourceDoc.documentElement, true);
  });
}

function buildArchiveDocument(archive, templateDb) {
  if (archive.schema !== "schemzip.aic-archive") {
    throw new Error("unsupported archive schema");
  }
  if (archive.library_hash && templateDb.source_hash && archive.library_hash !== templateDb.source_hash) {
    throw new Error("template database hash mismatch");
  }

  const templateByName = new Map((templateDb.templates || []).map((template) => [template.name, template]));
  const mxfile = document.implementation.createDocument("", "mxfile", null);
  const mxfileRoot = mxfile.documentElement;
  mxfileRoot.setAttribute("host", "app.diagrams.net");

  for (const page of archive.pages || []) {
    const diagram = mxfile.createElement("diagram");
    diagram.setAttribute("name", String(page.name || "Page"));
    diagram.setAttribute("id", String(page.id || ""));
    const graphDoc = buildGraphModel(page);
    const root = graphDoc.getElementsByTagName("root")[0];
    if (!root) {
      throw new Error("graph model missing root");
    }

    const dictionary = new Map((page.dictionary || []).map((entry) => [entry.template_index, entry]));
    const items = [...(page.items || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
    items.forEach((item, index) => {
      if (item.kind === "template") {
        const dictEntry = dictionary.get(item.template_index);
        if (!dictEntry) {
          throw new Error("missing template dictionary entry");
        }
        const template = templateByName.get(dictEntry.name);
        if (!template) {
          throw new Error(`missing template source for ${dictEntry.name}`);
        }
        const enriched = { ...item, id_prefix: `p${index}_` };
        expandTemplateItem(enriched, template.source_xml, graphDoc).forEach((cell) => root.appendChild(cell));
        return;
      }
      if (item.kind === "literal") {
        literalCells(item, graphDoc).forEach((cell) => root.appendChild(cell));
        return;
      }
      throw new Error(`unknown item kind: ${item.kind}`);
    });

    diagram.appendChild(graphDoc.documentElement);
    mxfileRoot.appendChild(diagram);
  }

  return mxfile;
}

async function loadTemplateDb(params) {
  const urls = resolveLibraryUrls(params);
  let lastError = null;
  for (const url of urls) {
    try {
      const templateDb = await fetchJson(url);
      if (params.lib && templateDb.library_id && normalizeLibraryId(params.lib) !== normalizeLibraryId(templateDb.library_id)) {
        throw new Error(`bookmark library mismatch: expected ${params.lib}, got ${templateDb.library_id}`);
      }
      if (
        params.ver &&
        templateDb.library_version &&
        normalizeVersionToken(params.ver) !== normalizeVersionToken(templateDb.library_version)
      ) {
        throw new Error(`bookmark version mismatch: expected ${params.ver}, got ${templateDb.library_version}`);
      }
      return { templateDb, url };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("unable to load template database");
}

function setStatus(kind, text) {
  const badge = document.getElementById("state-badge");
  badge.className = `badge ${kind}`;
  badge.textContent = text;
}

function setDetails(lines) {
  const container = document.getElementById("details");
  container.innerHTML = "";
  for (const line of lines) {
    const row = document.createElement("div");
    row.textContent = line;
    container.appendChild(row);
  }
}

function setPill(id, text) {
  document.getElementById(id).textContent = text;
}

function setBookmarkUrl(url) {
  const field = document.getElementById("bookmark-url");
  field.value = url;
  setPill("bookmark-pill", "bookmark: ready");
  document.getElementById("bookmark-hint").textContent = "Use this URL for a bookmark or share link.";
}

async function copyBookmarkUrl() {
  const field = document.getElementById("bookmark-url");
  const value = field.value.trim();
  if (!value) {
    throw new Error("bookmark URL is empty");
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  field.focus();
  field.select();
  const ok = document.execCommand("copy");
  field.setSelectionRange(0, 0);
  if (!ok) {
    throw new Error("clipboard copy failed");
  }
}

function showOverlay(message, error = null) {
  const overlay = document.getElementById("overlay");
  overlay.classList.remove("hidden");
  overlay.innerHTML = "";
  const content = document.createElement("div");
  content.textContent = message;
  overlay.appendChild(content);
  if (error) {
    const pre = document.createElement("pre");
    pre.textContent = error.stack || error.message || String(error);
    overlay.appendChild(pre);
  }
}

function setImportHint(text) {
  document.getElementById("import-hint").textContent = text;
}

function setDropzoneState(isDragging) {
  document.getElementById("drawio-dropzone").classList.toggle("dragover", isDragging);
}

function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("failed to read file"));
    reader.readAsText(file);
  });
}

function setBrowserUrl(url) {
  window.history.replaceState({}, "", url);
}

async function importDrawioFile(file) {
  const text = await readTextFile(file);
  const payload = buildDrawioUploadPayload(text, file.name);
  const encoded = await encodePayloadJson(payload);
  const params = {
    v: String(SCHEMA_VERSION),
    lib: "drawio",
    ver: "raw",
    data: encoded,
  };
  const bookmarkUrl = buildBookmarkUrl(window.location.href, params);
  setBookmarkUrl(bookmarkUrl);
  setPill("library-pill", "library: drawio/raw");
  setPill("payload-pill", `payload: ${encoded.length} chars`);
  setBrowserUrl(bookmarkUrl);
  setImportHint(`Imported ${file.name}`);
  updateDocumentTitle(file.name, new Date());
  setStatus("ok", "Imported");
  setDetails([
    `Imported file: ${file.name}`,
    "The browser address bar now contains the encoded payload.",
    "Save this URL as a bookmark to reopen the diagram later.",
  ]);
  hideOverlay();
  await bootEditor(text);
}

function hideOverlay() {
  document.getElementById("overlay").classList.add("hidden");
}

function setEditorUrl(url) {
  document.getElementById("editor").src = url;
}

async function bootEditor(xml) {
  const editorUrl = DEFAULT_EMBED_URL;
  const iframe = document.getElementById("editor");
  let ready = false;

  const receive = (event) => {
    if (!embeddedOrigins.has(event.origin)) {
      return;
    }
    if (typeof event.data !== "string" || event.data.length === 0) {
      return;
    }
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.event === "init") {
      ready = true;
      iframe.contentWindow?.postMessage(JSON.stringify({
        action: "load",
        autosave: 0,
        xml,
      }), "*");
    }
  };

  window.addEventListener("message", receive);
  iframe.src = editorUrl;
  setTimeout(() => {
    if (!ready) {
      setStatus("warn", "Waiting");
      setDetails([
        "The embed frame is still initializing.",
        "If the page stalls, verify that embed.diagrams.net is reachable and allows cross-origin messaging.",
      ]);
    }
  }, 4000);
}

async function bootApp() {
  document.getElementById("app-version").textContent = `program ${PROGRAM_VERSION}`;
  const fileInput = document.getElementById("drawio-file");
  const dropzone = document.getElementById("drawio-dropzone");
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) {
      return;
    }
    try {
      setImportHint(`Reading ${file.name}...`);
      await importDrawioFile(file);
    } catch (error) {
      setStatus("error", "Import failed");
      setImportHint(error.message || String(error));
      showOverlay("Failed to import .drawio file.", error);
    }
  });
  dropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    setDropzoneState(true);
  });
  dropzone.addEventListener("dragleave", () => {
    setDropzoneState(false);
  });
  dropzone.addEventListener("drop", async (event) => {
    event.preventDefault();
    setDropzoneState(false);
    const file = event.dataTransfer?.files?.[0];
    if (!file) {
      return;
    }
    try {
      fileInput.value = "";
      setImportHint(`Reading ${file.name}...`);
      await importDrawioFile(file);
    } catch (error) {
      setStatus("error", "Import failed");
      setImportHint(error.message || String(error));
      showOverlay("Failed to import .drawio file.", error);
    }
  });
  document.getElementById("copy-bookmark").addEventListener("click", async () => {
    try {
      await copyBookmarkUrl();
      document.getElementById("bookmark-hint").textContent = "Copied to clipboard.";
    } catch (error) {
      document.getElementById("bookmark-hint").textContent = error.message || String(error);
      setStatus("warn", "Copy failed");
    }
  });
  try {
    const { params } = parseBookmarkLocation();
    const payload = params.data;
    if (!payload) {
      setStatus("warn", "Missing payload");
      setPill("library-pill", "library: none");
      setPill("payload-pill", "payload: none");
      setBookmarkUrl(buildBookmarkUrl(window.location.href, params));
      setImportHint("Choose a .drawio file or drop one here to generate a bookmark URL.");
      setDetails([
        "Open the page with a bookmark fragment that includes `data`.",
        "Example:",
        "schemzip.html?lib=analog&ver=1.0.0#v=1&lib=analog&ver=1.0.0&data=...",
        "Or import a .drawio file to generate a browser URL directly.",
      ]);
      showOverlay("No archive payload found. Import a .drawio file to generate one.");
      return;
    }

    setPill("library-pill", `library: ${params.lib || "unknown"} @ ${params.ver || "unknown"}`);
    setPill("payload-pill", `payload: ${payload.length} chars`);
    setBookmarkUrl(buildBookmarkUrl(window.location.href, params));
    setStatus("warn", "Decoding");
    setDetails([
      `Schema version: ${params.v || "1"}`,
      `Library: ${params.lib || "unknown"}`,
      `Version: ${params.ver || "unknown"}`,
      "Restored XML remains in memory and is not written back to the URL.",
    ]);
    showOverlay("Decoding archive payload...");

    const archive = await decodePayloadJson(payload);
    if (archive.schema === RAW_DRAWIO_SCHEMA) {
      const sourceFile = archive.source_file || "diagram.drawio";
      const xml = String(archive.xml || "");
      updateDocumentTitle(sourceFile, archive.created_at ? new Date(archive.created_at) : new Date());
      setPill("payload-pill", `payload: ${payload.length} chars`);
      setStatus("ok", "Ready");
      setDetails([
        `Imported file: ${sourceFile}`,
        `Program version: ${archive.program_version || PROGRAM_VERSION}`,
        `Schema version: ${archive.schema_version || params.v || SCHEMA_VERSION}`,
        "Diagram XML is loaded directly into the iframe.",
      ]);
      document.getElementById("bookmark-hint").textContent = "Imported from a .drawio file. Copy the URL after verifying the diagram.";
      hideOverlay();
      await bootEditor(xml);
      return;
    }
    const { templateDb, url } = await loadTemplateDb(params);
    const mxfile = buildArchiveDocument(archive, templateDb);
    const xml = serializeXml(mxfile);

    setStatus("ok", "Ready");
    setDetails([
      `Template DB: ${url}`,
      `Archive pages: ${archive.page_count || archive.pages?.length || 0}`,
      `Program version: ${archive.program_version || PROGRAM_VERSION}`,
      `Schema version: ${archive.schema_version || params.v || SCHEMA_VERSION}`,
      "Diagram XML is loaded into the iframe on init.",
    ]);
    document.getElementById("bookmark-hint").textContent = "This URL is now ready to save as a bookmark.";
    hideOverlay();
    await bootEditor(xml);
  } catch (error) {
    setStatus("error", "Error");
    setPill("bookmark-pill", "bookmark: error");
    setDetails([
      error.message || String(error),
      "The bookmark could not be restored.",
    ]);
    showOverlay("Failed to restore bookmark.", error);
  }
}

if (typeof window !== "undefined") {
  window.schemzip = {
    decodeBase64Url,
    encodeBase64Url,
    decodePayloadJson,
    encodePayloadJson,
    buildShareUrl,
    buildBookmarkUrl,
    parseBookmarkLocation,
    resolveLibraryUrl,
    buildArchiveDocument,
  };

  bootApp();
}
