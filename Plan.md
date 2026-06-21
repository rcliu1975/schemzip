# SchemZip Development Plan

# Goal

Develop a bookmark-first web application for draw.io analog schematics.

The system shall:

* Compress `.drawio` XML into a bookmark-safe URL fragment.
* Let the bookmark itself function as the diagram link.
* Load the matching stencil library by version from GitHub Raw content.
* Avoid depending on cloud storage, login, a database, or server-side processing.
* Restore draw.io XML in the browser.
* Display the diagram in `embed.diagrams.net` via `postMessage`.
* Keep the current CLI/core compression engine versioned and reproducible.
* Continuously improve recognition accuracy using an expanding corpus.
* 程式要有版本資訊,可以隨時確認.
* 壓縮後的資料需要有程式版號與 library 版本資訊，以便後續解碼驗證.

---

# Architecture

```text
Bookmark
    ↓
schemzip.html?lib=Analog&ver=v1.0.0#<compressed-data>
    ↓
Download stencil library from GitHub Raw
    ↓
Decode compressed data
    ↓
Restore Draw.io XML
    ↓
Embed diagrams.net
    ↓
Display Diagram
```

Current core engine path:

```text
.drawio
    ↓
Parser
    ↓
Graph Builder
    ↓
Template Matcher
    ↓
Instances
    ↓
Serializer
    ↓
.aic
```

Restore path:

```text
.aic
    ↓
Deserializer
    ↓
Instance Expander
    ↓
drawio Generator
    ↓
.drawio
```

---

# Core Engine Status

## Phase 1 - Stencil Database

Input:

```text
Analog.xml
```

Output:

```text
template_db.json
template_db.pkl
```

Status:

- [x] Parse mxlibrary
- [x] Extract all symbols
- [x] Normalize coordinates
- [x] Store canonical representation
- [x] Generate template database

Deliverables:

- `parse_library.py`
- `template_db.json`
- `template_db.pkl`

Note:

* These artifacts are still used by the current CLI/core path.
* The Web UI roadmap prefers versioned library fetches from GitHub Raw.

---

## Phase 2 - Drawio Parser

Input:

```text
*.drawio
```

Output:

```text
CellGraph
```

Status:

- [x] Parse mxGraphModel
- [x] Build connectivity graph
- [x] Find connected components
- [x] Calculate bounding boxes
- [x] Normalize coordinates

Validated on `drawio_samples/AnlogIC.drawio`.

Deliverables:

- `parse_drawio.py`
- `graph_builder.py`

---

## Phase 3 - Template Matching

Goal:

Recognize flattened symbols inside candidate components.

Status:

- [x] `matcher.py`
- [ ] `matcher_test.py`

Deliverables:

- `matcher.py`

---

## Phase 4 - Compression / Restore

Output format:

```text
AIC1
```

Status:

- [x] `compress_aic.py`
- [x] `restore_aic.py`

Validated on `drawio_samples/AnlogIC.drawio`:

- AIC archive: 1.5K
- restored drawio: 16K
- 39 mxCells preserved

Deliverables:

- `compress_aic.py`
- `restore_aic.py`

---

# Web UI Roadmap

## Product Shape

Opening a bookmark shall:

1. Load `schemzip.html`.
2. Read `lib`, `ver`, and compressed payload from the URL.
3. Download the corresponding stencil library.
4. Restore draw.io XML in the browser.
5. Display the diagram in `embed.diagrams.net`.

This is the browser-facing product direction. The CLI/core engine remains useful for build-time and regression workflows, but it is not the primary user interface.

## URL Format

Target URL:

```text
http://localhost:8080/schemzip.html?lib=Analog&ver=v1.0.0#<compressed-data>
```

Where:

```text
lib
    stencil library name

ver
    git tag / release version

compressed-data
    schemzip encoded diagram
```

The restored XML must not be pushed back into the URL.

## Phase 5 - Bookmark URL Parsing

Tasks:

- Parse URL hash and query parameters
- Extract `lib`, `ver`, and compressed payload
- Keep restored XML out of the URL

Deliverables:

- `schemzip.html`
- URL parser logic
- share URL builder

---

## Phase 6 - Versioned Library Loading

Library source:

```text
https://raw.githubusercontent.com/rcliu1975/schemzip/v1.0.0/Analog.xml
```

Tasks:

- Download versioned stencil library from GitHub Raw
- Avoid `main/Analog.xml`
- Validate bookmark library version for reproducible decoding
- Cache library metadata locally when needed

Do not rely on Local Storage sharing across origins. Use the embed-first browser flow instead of a viewer page that cannot access local bookmark state.

Deliverables:

- library loader
- versioned library metadata

---

## Phase 7 - Draw.io Embed Integration

Use:

```text
https://embed.diagrams.net/?embed=1&proto=json
```

Tasks:

- Initialize iframe
- Wait for the embed ready message
- Send `load` message with restored XML
- Render the diagram inside the browser
- Use `postMessage` as the integration mechanism
- Keep the restored XML in memory, not in the bookmark URL

Deliverables:

- embed UI integration
- `postMessage` bridge

---

## Phase 8 - Bookmark Generation

V1:

- Manual bookmark creation
- Generate URL
- Copy URL
- User saves bookmark

This is the required first release path.

V2:

- Optional Chrome Extension
- `bookmarks` permission only
- Generate URL and create bookmark automatically

The extension is optional and should not block the first release.

Deliverables:

- bookmark-friendly URL generator
- optional extension plan

---

# Success Criteria

A user can:

```text
Open Bookmark
    ↓
Restore Diagram
    ↓
View Diagram
```

without:

* cloud storage
* local files
* login
* server-side processing

and obtain the same diagram years later using the library version encoded in the bookmark.

---

# Future Features

* Multi-library support
* GitHub release auto-discovery
* Library cache
* Offline mode
* Bookmark folder organization
* Diagram search
* Diagram metadata

---

# Success Criteria

A user can:

```text
Open Bookmark
    ↓
Restore Diagram
    ↓
View Diagram
```

without:

* cloud storage
* local files
* login
* server-side processing

and obtain the same diagram years later using the library version encoded in the bookmark.
