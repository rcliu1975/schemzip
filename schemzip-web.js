const PROGRAM_VERSION = "0.1.0";
const SCHEMA_VERSION = 1;
const DEFAULT_OWNER = "rcliu1975";
const DEFAULT_REPO = "schemzip";
const CUSTOM_LIBRARY_URL = "https://raw.githubusercontent.com/rcliu1975/schemzip/refs/heads/main/Analog.xml";
const DEFAULT_EMBED_URL =
  `https://embed.diagrams.net/?embed=1&proto=json&spin=1&libraries=1&noSaveBtn=0&saveAndExit=0&noExitBtn=1&ui=min&lang=en&clibs=U${encodeURIComponent(CUSTOM_LIBRARY_URL)}`;
const RAW_DRAWIO_SCHEMA = "schemzip.drawio-xml";
const CUSTOM_LIBRARY_TITLE = "Analog";
const BLANK_DRAWIO_XML =
  '<mxGraphModel grid="1" gridSize="8"><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';

const templateCache = new Map();
let customLibraryXmlPromise = null;
let editorMessageHandler = null;
const embeddedOrigins = new Set(["https://embed.diagrams.net"]);
const DEBUG_MODE = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debug") === "1";
const appState = {
  sourceFile: "diagram.drawio",
  currentXml: "",
  mode: "bookmark",
};

function debugLog(message) {
  if (!DEBUG_MODE) {
    return;
  }
  const text = typeof message === "string" ? message : JSON.stringify(message);
  console.debug(`[schemzip] ${text}`);
  const panel = document.getElementById("debug-panel");
  const log = document.getElementById("debug-log");
  if (!panel || !log) {
    return;
  }
  panel.classList.remove("hidden");
  const lines = log.textContent ? `${log.textContent}\n` : "";
  log.textContent = `${lines}${new Date().toISOString()} ${text}`;
}

function debugError(label, error) {
  const message = error?.stack || error?.message || String(error);
  debugLog(`${label}: ${message}`);
}

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

async function fetchText(url) {
  debugLog(`fetchText start: ${url}`);
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`failed to load ${url}: ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  debugLog(`fetchText ok: ${url} (${text.length} chars)`);
  return text;
}

function getCustomLibraryXml() {
  if (!customLibraryXmlPromise) {
    debugLog("custom library cache miss");
    customLibraryXmlPromise = fetchText(CUSTOM_LIBRARY_URL);
  } else {
    debugLog("custom library cache hit");
  }
  return customLibraryXmlPromise;
}

function postEditorMessage(iframe, message) {
  iframe.contentWindow?.postMessage(JSON.stringify(message), "*");
}

async function loadDiagramIntoEditor(iframe, xml) {
  debugLog(`sending load (${xml.length} chars)`);
  postEditorMessage(iframe, {
    action: "load",
    autosave: 0,
    xml,
  });
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
  document.title = `Schemzip: ${baseName} - ${formatEnglishDateTime(date)}`;
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

async function buildRawDrawioBookmarkUrl(xml, sourceFile) {
  const payload = buildDrawioUploadPayload(xml, sourceFile);
  const encoded = encodePayloadJson(payload);
  const data = await encoded;
  return buildBookmarkUrl(window.location.href, {
    v: String(SCHEMA_VERSION),
    lib: "drawio",
    ver: "raw",
    data,
  });
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
    gridSize: String(graphAttrs.gridSize ?? 8),
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
  if (!container) {
    return;
  }
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
  setBrowserUrl(url);
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
  document.getElementById("toolbar-hint").textContent = text;
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

function setFilename(value) {
  const field = document.getElementById("filename");
  field.value = value;
  appState.sourceFile = value;
  updateDocumentTitle(value, new Date());
}

function setPayloadStatus(sizeText) {
  setPill("payload-pill", sizeText);
}

async function updateHostUrlForCurrentDiagram(xml, filename) {
  const sourceFile = String(filename || "diagram.drawio");
  const payload = buildDrawioUploadPayload(xml, sourceFile);
  const encoded = await encodePayloadJson(payload);
  const bookmarkUrl = buildBookmarkUrl(window.location.href, {
    v: String(SCHEMA_VERSION),
    lib: "drawio",
    ver: "raw",
    data: encoded,
  });
  setBookmarkUrl(bookmarkUrl);
  setPill("payload-pill", `payload: ${encoded.length} chars`);
  return { bookmarkUrl, payloadSize: encoded.length };
}

async function importDrawioFile(file) {
  const text = await readTextFile(file);
  setFilename(file.name);
  appState.currentXml = text;
  appState.mode = "raw";
  const { payloadSize } = await updateHostUrlForCurrentDiagram(text, file.name);
  setImportHint(`Opened ${file.name}`);
  setStatus("ok", "Opened");
  setDetails([
    `Opened file: ${file.name}`,
    `Payload size: ${payloadSize} chars`,
    "The browser address bar and tab title were updated.",
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
  debugLog("bootEditor start");
  const editorUrl = DEFAULT_EMBED_URL;
  const iframe = document.getElementById("editor");
  let ready = false;
  appState.currentXml = xml;

  const receive = async (event) => {
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
    debugLog(`iframe event: ${msg.event || "unknown"}`);
    if (msg.event === "init") {
      ready = true;
      await loadDiagramIntoEditor(iframe, xml);
      return;
    }
    if (msg.event === "template" && (msg.blank || typeof msg.xml === "string")) {
      const nextXml = msg.blank ? BLANK_DRAWIO_XML : String(msg.xml || BLANK_DRAWIO_XML);
      debugLog(`template selection received (blank=${Boolean(msg.blank)}, xml=${nextXml.length} chars)`);
      appState.currentXml = nextXml;
      appState.mode = "raw";
      updateDocumentTitle(appState.sourceFile || "diagram.drawio", new Date());
      setImportHint("New diagram loaded.");
      await loadDiagramIntoEditor(iframe, nextXml);
      return;
    }
    if (msg.event === "save" && typeof msg.xml === "string" && msg.xml.length > 0) {
      debugLog(`save event received (${msg.xml.length} chars)`);
      appState.currentXml = msg.xml;
      appState.mode = "raw";
      const currentFilename = document.getElementById("filename").value.trim() || appState.sourceFile || "diagram.drawio";
      setFilename(currentFilename);
      setStatus("ok", "Saved");
      setImportHint(`Saved ${currentFilename}.`);
      setDetails([
        `Saved file: ${currentFilename}`,
        "The browser address bar and tab title were updated.",
        "Bookmark the page URL to preserve this revision.",
      ]);
      updateHostUrlForCurrentDiagram(msg.xml, currentFilename).catch((error) => {
        setStatus("warn", "Save updated");
        setImportHint(error.message || String(error));
      });
    }
  };

  if (editorMessageHandler) {
    window.removeEventListener("message", editorMessageHandler);
  }
  editorMessageHandler = receive;
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

function requestNewFile(nextFilename = "untitled.drawio") {
  const iframe = document.getElementById("editor");
  if (!iframe.contentWindow) {
    setStatus("warn", "Waiting");
    setImportHint("The editor is still starting.");
    return;
  }
  setStatus("warn", "Template");
  setFilename(nextFilename);
  setImportHint(`New diagram started as ${nextFilename}.`);
  postEditorMessage(iframe, {
    action: "template",
    callback: true,
    noExitOnCancel: true,
  });
}

async function bootApp() {
  const fileInput = document.getElementById("drawio-file");
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
  document.getElementById("new-file").addEventListener("click", () => {
    requestNewFile();
  });
  document.getElementById("open-file").addEventListener("click", () => {
    document.getElementById("drawio-file").click();
  });
  document.getElementById("filename").addEventListener("change", () => {
    const value = document.getElementById("filename").value.trim() || "diagram.drawio";
    setFilename(value);
    if (appState.currentXml) {
      updateHostUrlForCurrentDiagram(appState.currentXml, value).catch((error) => {
        setImportHint(error.message || String(error));
      });
    }
  });
  try {
    const { params } = parseBookmarkLocation();
    const payload = params.data;
    if (!payload) {
      setStatus("ok", "Ready");
      setFilename("diagram.drawio");
      setPayloadStatus("payload: 0 chars");
      setBookmarkUrl(window.location.href);
      setImportHint("A blank diagram is open. Use New or Open.");
      setDetails([
        "No archive payload was found in the URL.",
        "The embedded editor is open on a blank diagram.",
        "Open a .drawio file or press New to start a diagram.",
      ]);
      hideOverlay();
      await bootEditor(BLANK_DRAWIO_XML);
      return;
    }

    setPayloadStatus(`payload: ${payload.length} chars`);
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
      setFilename(sourceFile);
      appState.currentXml = xml;
      appState.mode = "raw";
      updateDocumentTitle(sourceFile, archive.created_at ? new Date(archive.created_at) : new Date());
      setPayloadStatus(`payload: ${payload.length} chars`);
      setStatus("ok", "Ready");
      setDetails([
        `Imported file: ${sourceFile}`,
        `Program version: ${archive.program_version || PROGRAM_VERSION}`,
        `Schema version: ${archive.schema_version || params.v || SCHEMA_VERSION}`,
        "Diagram XML is loaded directly into the iframe.",
      ]);
      setImportHint("Imported from a .drawio file.");
      hideOverlay();
      await bootEditor(xml);
      return;
    }
    const { templateDb, url } = await loadTemplateDb(params);
    const mxfile = buildArchiveDocument(archive, templateDb);
    const xml = serializeXml(mxfile);
    appState.currentXml = xml;
    appState.mode = "archive";
    setFilename(String(archive.source_file || "diagram.drawio"));

    setStatus("ok", "Ready");
    setDetails([
      `Template DB: ${url}`,
      `Archive pages: ${archive.page_count || archive.pages?.length || 0}`,
      `Program version: ${archive.program_version || PROGRAM_VERSION}`,
      `Schema version: ${archive.schema_version || params.v || SCHEMA_VERSION}`,
      "Diagram XML is loaded into the iframe on init.",
    ]);
    setImportHint("This URL is now ready to save as a bookmark.");
    hideOverlay();
    await bootEditor(xml);
  } catch (error) {
    setStatus("error", "Error");
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
