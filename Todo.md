

# TODO.md — SchemZip + Draw.io Bookmark-Only Share Architecture

## 目標

建立一套完全無後端（Serverless）的 Draw.io 分享機制：

* 使用 SchemZip 對 `.drawio` XML 進行查表壓縮
* Stencil Library（例如 Analog.xml）存放於 GitHub
* 壓縮資料直接存入 URL
* 分享時只需一個 URL
* 開啟 URL 時自動還原 Draw.io XML
* 使用 Draw.io Viewer / Editor 檢視與編輯
* 不需要資料庫
* 不需要檔案儲存
* 不需要登入

---

# Architecture

```text
                 GitHub
                     │
                     │
                     ▼
           Stencil Library
              Analog.xml
                     │
                     │
                     ▼

.drawio XML
      │
      ▼
SchemZip Compressor
      │
      ▼
Token Stream
      │
      ▼
Base64URL
      │
      ▼
Share URL

https://schemzip.app/#lib=analog
                     &ver=1.0.0
                     &data=xxxxx

────────────────────────────────

Open URL

      ▼
Load Analog.xml
      ▼
Build Dictionary
      ▼
Decode Base64URL
      ▼
SchemZip Decompress
      ▼
Draw.io XML
      ▼
Draw.io Viewer/Editor
```

---

# Phase 1 — Stencil Library Repository

## 建立 Library Repository Structure

```text
/docs
/libs

/libs/analog
    analog-v1.xml
    analog-v1.json

/libs/aws
    aws-v1.xml

/libs/network
    network-v1.xml
```

---

## GitHub Pages

啟用 GitHub Pages：

```text
https://rcliu1975.github.io/schemzip/
```

Library URL：

```text
https://rcliu1975.github.io/schemzip/libs/analog/analog-v1.xml
```

---

## Library Metadata

建立：

```json
{
  "id": "analog",
  "version": "1.0.0",
  "sha256": "xxxxxxxx",
  "symbols": 520
}
```

用途：

* 驗證版本
* 驗證 Hash
* Cache 控制

---

# Phase 2 — Dictionary Builder

## Parse Analog.xml

輸入：

```xml
<shape name="OpAmp">
...
</shape>
```

產生：

```json
{
  "OpAmp": 1,
  "Resistor": 2,
  "Capacitor": 3
}
```

---

## Generate Reverse Dictionary

```json
{
  "1": "OpAmp",
  "2": "Resistor",
  "3": "Capacitor"
}
```

---

## Build-time Tool

新增：

```text
/tools/build-dictionary.js
```

功能：

* 解析 stencil XML
* 產生 dictionary
* 產生 reverse dictionary
* 計算 SHA256

目前已先完成一版 build-time dictionary 產生器，直接讀取 `template_db.json` 並輸出：

* `dictionary.json`
* `reverse_dictionary.json`

後續若需要可再把它往前推到直接吃 raw stencil XML。

---

# Phase 3 — SchemZip Compression Engine

## XML Parser

讀取：

```text
diagram.drawio
```

解析：

```xml
<mxCell ...>
```

---

## Symbol Detection

辨識：

```text
OpAmp
Resistor
Capacitor
```

轉換：

```text
1
2
3
```

---

## Compression

輸出：

```json
{
  "lib":"analog",
  "ver":"1.0.0",
  "payload":"..."
}
```

---

## Base64URL Encoding

將：

```text
binary payload
```

轉換：

```text
ABCDEFGHIJKLMNOPQRSTUVWXYZ
abcdefghijklmnopqrstuvwxyz
0123456789
-_
```

避免：

```text
+
/
=
```

---

# Phase 4 — Share URL Format

## URL Schema v1

```text
https://schemzip.app/#

v=1
&lib=analog
&ver=1.0.0
&sha=abcdef
&data=xxxxx
```

---

## Compact Format

未來可考慮：

```text
#analog@1.0.0:xxxxx
```

---

## URL Parser

建立：

```text
/src/url-parser.ts
```

功能：

* 解析 hash
* 驗證參數
* 取得 payload

目前已在 Python 端補上共用模組 `schemzip_url.py`，可直接處理：

* Base64URL encode/decode
* share fragment parse/build
* share payload encode/decode

---

# Phase 5 — Library Loader

## Dynamic Library Loading

根據：

```text
lib=analog
ver=1.0.0
```

載入：

```text
https://rcliu1975.github.io/schemzip/libs/analog/analog-v1.xml
```

---

## Cache

使用：

```javascript
localStorage
```

Cache Key：

```text
library:analog:1.0.0
```

---

## SHA256 Validation

驗證：

```text
下載檔案 SHA256
=
URL SHA256
```

若失敗：

```text
Version mismatch
```

停止解壓縮。

目前已在本機 AIC / share URL 還原流程中保留 `library_hash` 比對：

* 若 archive 內的 `library_hash` 與本機 `template_db.json` 不一致，還原會失敗
* 真正的遠端 library 下載與 hash 驗證仍待下一階段補上

---

# Phase 6 — Decompression Engine

## Download Library

```text
Library Loader
```

↓

```text
Dictionary Builder
```

↓

```text
Reverse Dictionary
```

---

## Restore XML

還原：

```text
Token Stream
```

↓

```text
Draw.io XML
```

---

## XML Validation

驗證：

```xml
<mxGraphModel>
```

存在。

若失敗：

```text
Invalid draw.io file
```

---

# Phase 7 — Draw.io Integration

## Option A — Embed Mode（推薦）

使用：

```text
https://embed.diagrams.net/
```

---

## iframe

```html
<iframe
  id="drawio"
  src="https://embed.diagrams.net/"
></iframe>
```

---

## Load Diagram

```javascript
iframe.contentWindow.postMessage(
{
  action: "load",
  xml: drawioXml
},
"*"
);
```

---

## Save Callback

接收：

```javascript
window.addEventListener("message")
```

取得：

```text
Updated XML
```

重新壓縮。

---

# Phase 8 — Viewer Mode

## Read-only

URL：

```text
/viewer
```

功能：

* Zoom
* Pan
* Export PNG
* Export SVG

---

# Phase 9 — Editor Mode

## Editable

URL：

```text
/editor
```

功能：

* 編輯圖面
* 儲存
* 重新產生 Share URL

---

## Generate Share Link

按鈕：

```text
Share
```

流程：

```text
Current XML
 ↓
Compress
 ↓
Generate URL
 ↓
Copy Clipboard
```

---

# Phase 10 — Progressive Web App

## Installable PWA

建立：

```text
manifest.json
```

---

## Offline Support

Cache：

```text
HTML
JS
CSS
Library Metadata
```

---

## Service Worker

```text
sw.js
```

---

# Phase 11 — Performance

## Lazy Load Libraries

不要預載：

```text
AWS
Network
Analog
```

只載入需要的。

---

## Compression Benchmark

測試：

| File            | Original | Compressed | Ratio |
| --------------- | -------: | ---------: | ----: |
| Analog Sample   |   100 KB |      12 KB |   88% |
| Network Diagram |   250 KB |      30 KB |   88% |
| ERD             |   500 KB |      55 KB |   89% |

---

# Phase 12 — Compatibility

## 測試 Draw.io

測試：

* Draw.io Desktop
* Draw.io Web
* Embed Draw.io

---

## Browser Support

測試：

* Chrome
* Edge
* Firefox
* Safari

---

# Future Enhancements

## Multiple Libraries

```text
lib=analog,network,aws
```

---

## Automatic Library Discovery

自動偵測：

```text
OpAmp
```

⇒

```text
Analog Library
```

---

## URL Compression Layer

加入：

* Brotli
* Deflate
* LZMA

比較壓縮率。

---

## Optional Cloud Storage

未來可選：

* GitHub Gist
* GitHub Repository
* Cloudflare R2

但 Bookmark-Only 模式仍為預設。

---

# MVP Definition

第一版完成條件：

* [ ] GitHub Pages 可提供 Analog.xml
* [x] 建立 Dictionary Builder
* [x] SchemZip 壓縮 Draw.io XML
* [x] Base64URL Encode
* [x] 產生 Share URL
* [x] URL 可還原 Draw.io XML
* [ ] 自動下載對應 Library
* [ ] SHA256 驗證
* [ ] Embed Draw.io Viewer
* [ ] Embed Draw.io Editor
* [x] Share Link 功能
* [ ] 完全無後端
* [ ] 可部署於 GitHub Pages

目前可用狀態：

* 壓縮端可直接輸出 bookmark share URL
* 還原端可直接吃 share URL 並還原為 draw.io XML

完成後即可達成：

**「一個 URL = 一個完整 Draw.io 圖檔，可分享、可還原、可編輯、無需伺服器儲存。」**
