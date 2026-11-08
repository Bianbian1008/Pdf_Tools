# PDF 合併與分割

用 Edge 或 Chrome 開啟 `index.html`。可匯入多份 PDF、拖曳排序、逐頁勾選、預覽和匯出。PDF 在瀏覽器內處理。執行工具時，請讓 `index.html`、`app.js`、`style.css` 和 `vendor/` 留在同一個資料夾。

## 版本管理

第一次發布可以標成 `v0.1.0`。日後從 `main` 開新分支新增功能或修錯，測試後用 Pull Request 合併。每次發布用 GitHub Releases 建立標籤並記錄改動。修錯可用 `v0.1.1`，新增相容功能可用 `v0.2.0`。需要舊版時，可從對應的 Release 下載原始碼。

每次更新後，至少檢查匯入、排序、合併、分割、預覽和另存新檔。若改動 PDF.js，請再用含中文字型和掃描圖片的 PDF 檢查縮圖與輸出預覽。

## 第三方套件

| 套件 | 版本 | 用途 |
| --- | --- | --- |
| PDF.js（pdfjs-dist） | 6.5.438 | 頁面縮圖與輸出預覽 |
| pdf-lib | 1.17.1 | PDF 合併、分割與版面配置 |
| fflate | 0.8.3 | 將多份分割結果打包成 ZIP |

`vendor/` 內含套件和授權文件。更新 PDF.js 時，主程式、worker 與資源需一起更新。目前使用 esbuild 0.28.2 將 PDF.js 的 legacy 主程式和 worker 轉成瀏覽器可直接載入的 IIFE，以支援本機離線開啟。CMap、標準字型、JBIG2 和 OpenJPEG 資源以 Base64 內附。更新時請同步更新上表並檢查安全公告。

請勿將來源 PDF、匯出檔案、帳號憑證或私密金鑰提交到 GitHub。
