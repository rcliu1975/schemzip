# schemzip

一個針對 draw.io 類比電路圖的 Cell Recognition + Dictionary Compression 原型。

## 專案目標

- 自動辨識 draw.io 圖中的展平符號
- 以 `Analog.xml` 作為符號模板資料庫
- 將重複的圖形幾何壓縮成精簡參考
- 支援無損解壓回 draw.io 格式
- 壓縮檔與程式本身都保留版本資訊，方便檢查相容性
- 進一步發展成 bookmark-first 的 Web UI，而不只是 CLI 工具

## 目前進度

- Phase 1 已完成：Stencil Database
- Phase 2 已完成：Drawio Parser / CellGraph
- Phase 3 已完成：Template Matching
- Phase 4 已完成：AIC 壓縮 / 還原
- Phase 5 已開始落地：`schemzip.html` 入口、URL parser、share URL builder
- Phase 6 已完成主要落地：versioned library loader + 本地 metadata cache
- Phase 7 基本 embed bridge 已落地：iframe / `postMessage` / `load` 流程
- Phase 8 已開始落地：bookmark URL 生成與複製
- `schemzip.html` 現在可讀取 bookmark、還原 archive，並輸出可複製的 canonical bookmark URL
- Web UI 方向已在 `Plan.md` 定義為 bookmark-first / `embed.diagrams.net` 架構

## Plan.md 工作現狀

`Plan.md` 的主線目前分成兩段：

- Core engine：Phase 1 到 Phase 4 已完成，包含 `Analog.xml` stencil database、`.drawio` 解析、模板比對、`.aic` 壓縮與還原
- Web UI：正在往 bookmark-first 的瀏覽器端流程推進，核心目標是 `schemzip.html`、`embed.diagrams.net`、GitHub Raw library、share URL 與 bookmark 生成

目前 `graph.json` 只作為中間分析格式使用，不是最終壓縮格式；Web UI 的最終交付格式是 bookmark 可攜帶的 share URL。

## 版本資訊

- 程式版本：`0.1.0`
- 資料結構版本：`1`

壓縮/解析輸出會帶上這些資訊，方便後續驗證。

## 檔案說明

- `Analog.xml`：模板庫來源，內容是 `mxlibrary`
- `parse_library.py`：解析 `Analog.xml` 並產生模板資料庫
- `template_db.json`：模板資料庫的 JSON 版本
- `template_db.pkl`：模板資料庫的 pickle 版本
- `parse_drawio.py`：解析 `.drawio` 並輸出 CellGraph
- `graph_builder.py`：建立連通元件、bbox 與正規化資料
- `matcher.py`：模板比對與 canonical signature
- `compress_aic.py`：將 `.drawio` 壓縮成 `.aic`
- `restore_aic.py`：將 `.aic` 還原成 `.drawio`
- `schemzip_url.py`：share URL、Base64URL 與 payload 編解碼
- `schemzip.html`：bookmark-first Web UI 入口
- `schemzip-web.js`：browser 端 URL parsing、library loading、archive restore、embed bridge
- `tools/build-dictionary.js`：產生 dictionary / reverse dictionary 的 build-time 工具
- `drawio_samples/AnlogIC.drawio`：測試樣本
- `drawio_samples/Analog_Symbols_Text.drawio`：額外的 draw.io corpus sample
- `Plan.md`：開發計畫與 bookmark-first Web UI roadmap

## 使用方式

### 產生模板資料庫

```bash
cd schemzip
python3 parse_library.py
```

預設會讀取 `Analog.xml`，並輸出：

- `template_db.json`
- `template_db.pkl`

### 解析 draw.io 檔案

```bash
cd schemzip
python3 parse_drawio.py drawio_samples/AnlogIC.drawio
```

預設會輸出：

- `drawio_samples/AnlogIC.graph.json`

### 壓縮成 AIC

```bash
cd schemzip
python3 compress_aic.py drawio_samples/AnlogIC.drawio -o drawio_samples/AnlogIC.aic
```

預設會使用同目錄的 `template_db.json` 做查表壓縮。

### 還原 AIC

```bash
cd schemzip
python3 restore_aic.py drawio_samples/AnlogIC.aic -o drawio_samples/AnlogIC.restored.drawio
```

還原時會讀取本機的 `template_db.json`，並檢查 `library_hash` 是否一致。

### Web UI 使用方式

Web UI 入口是 `schemzip.html`。建議用本機 HTTP server 開啟，不要直接用 `file://`，這樣 `fetch`、`localStorage` 與 `embed.diagrams.net` 的互動會比較穩定。

```bash
cd schemzip
python3 -m http.server 8080
```

然後開啟：

```text
http://localhost:8080/schemzip.html?lib=analog&ver=1.0.0#v=1&sha=<library-hash>&data=<compressed-data>
```

操作流程：

1. 開啟含有 bookmark fragment 的 `schemzip.html`
2. 頁面會先下載對應版本的 `template_db.json`
3. 接著在瀏覽器內還原 archive 成 draw.io XML
4. 最後把 XML 送進 `embed.diagrams.net` iframe 顯示
5. 頁面下方會產生 canonical bookmark URL，可直接按 `Copy URL`
6. 使用者再把目前網址手動存成瀏覽器書籤

如果一開始沒有 payload：

1. 用頁面中的 `.drawio` 檔案選擇器，或把檔案拖到 import 區塊
2. Web UI 會把檔案編碼進目前分頁的網址列
3. 分頁標題會改成 `Drawio: 檔名 - 英文日期時間`
4. 之後你就可以直接複製該 URL 當 bookmark 使用

注意：

- `lib` 和 `ver` 要與 bookmark 內容一致
- 壓縮資料放在 URL fragment，不會寫回 restored XML
- 第一次開啟時如果瀏覽器沒有快取，會直接抓 GitHub Raw 上的版本化 metadata
- `embed.diagrams.net` 預設使用英文介面
- `embed.diagrams.net` 會在 init 後直接透過 `loadLibs` 載入 `Analog.xml` stencil library
- 在 iframe 內按 `Save` 後，外層頁面會回寫 canonical URL 到網址列

## 備註

- `graph.json` 是中間分析格式，不是最終壓縮格式
- `.aic` 才是最終交付的查表壓縮格式
- 目前 `parse_library.py`、`parse_drawio.py`、`compress_aic.py`、`restore_aic.py` 皆已可執行
- `Plan.md` 會持續反映 core engine 與 Web UI 的分階段進度

## Plan.md Web UI Roadmap

`Plan.md` 描述的是 bookmark-first 的 Web UI 方向，重點如下：

- 使用者以 bookmark 開啟 `schemzip.html`
- 由 URL 下載對應版本的 stencil library metadata
- 透過 `embed.diagrams.net` 顯示還原後圖面
- 壓縮資料放在 URL fragment 中
- Chrome Extension 僅列為 optional
