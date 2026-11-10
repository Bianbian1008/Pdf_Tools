# PDF 合併與分割

用 Edge 或 Chrome 開啟 `PDF合併與分割.html`。可匯入多份 PDF、拖曳排序、逐頁勾選、預覽和匯出。PDF 在瀏覽器內處理。執行工具時，請讓 `PDF合併與分割.html`、`app.js`、`style.css` 和 `vendor/` 留在同一個資料夾。

## PDF 上鎖與解鎖

匯入加密 PDF 時，可輸入原始密碼解鎖。要匯出不需密碼的副本，維持「為輸出的 PDF 上鎖」未勾選。勾選後可設定 AES-256 開啟密碼，多份輸出會套用到每份 PDF。工具和套件均可離線執行。

## 版本管理

第一次發布可以標成 `v0.1.0`。日後從 `main` 開新分支新增功能或修錯，測試後用 Pull Request 合併。每次發布用 GitHub Releases 建立標籤並記錄改動。修錯可用 `v0.1.1`，新增相容功能可用 `v0.2.0`。需要舊版時，可從對應的 Release 下載原始碼。

每次更新後，至少檢查匯入、排序、合併、分割、預覽和另存新檔。若改動 PDF.js，請再用含中文字型和掃描圖片的 PDF 檢查縮圖與輸出預覽。

## 第三方套件

| 套件 | 版本 | 用途 |
| --- | --- | --- |
| PDF.js（pdfjs-dist） | 6.5.438 | 頁面縮圖與輸出預覽 |
| pdf-lib | 1.17.1 | PDF 合併、分割與版面配置 |
| fflate | 0.8.3 | 將多份分割結果打包成 ZIP |
| @neslinesli93/qpdf-wasm（QPDF 12.2.0） | 0.3.1 | PDF 解鎖與 AES-256 上鎖 |

`vendor/` 內含套件和授權文件。更新 PDF.js 時，主程式、worker 與資源需一起更新。目前使用 esbuild 0.28.2 將 PDF.js 的 legacy 主程式和 worker 轉成瀏覽器可直接載入的 IIFE，以支援本機離線開啟。CMap、標準字型、JBIG2 和 OpenJPEG 資源以 Base64 內附。更新時請同步更新上表並檢查安全公告。

請勿將來源 PDF、匯出檔案、帳號憑證或私密金鑰提交到 GitHub。

QPDF 的 WASM 以 Base64 放在 `vendor/qpdf-binary.js`。內附的 `vendor/qpdf.js` 載入器調整為優先讀取傳入的 `wasmBinary`，以支援離線與現有的內容安全政策。命令列輸出也改成可由呼叫端接收，以便辨識密碼錯誤。
