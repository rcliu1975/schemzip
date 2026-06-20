# schemzip

一個針對 draw.io 類比電路圖的 Cell Recognition + Dictionary Compression 原型。

## 專案目標

- 自動辨識 draw.io 圖中的展平符號
- 以 `Analog.xml` 作為符號模板資料庫
- 將重複的圖形幾何壓縮成精簡參考
- 支援無損解壓回 draw.io 格式
- 壓縮檔與程式本身都保留版本資訊，方便檢查相容性

## 目前進度

- Phase 1 已完成：Stencil Database
- Phase 2 已完成：Drawio Parser / CellGraph
- Phase 3：Template Matching，尚未開始

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
- `drawio_samples/AnlogIC.drawio`：測試樣本
- `Plan.md`：開發計畫與階段進度

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

## 備註

- 目前 `parse_library.py` 與 `parse_drawio.py` 皆已可執行
- `Plan.md` 會持續反映分階段進度
- 後續會補上 Template Matching 與壓縮/解壓格式
