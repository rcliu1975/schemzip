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
- Phase 3 已完成：Template Matching
- Phase 4 已完成：AIC 壓縮 / 還原

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

## 備註

- `graph.json` 是中間分析格式，不是最終壓縮格式
- `.aic` 才是最終交付的查表壓縮格式
- 目前 `parse_library.py`、`parse_drawio.py`、`compress_aic.py`、`restore_aic.py` 皆已可執行
- `Plan.md` 會持續反映分階段進度
