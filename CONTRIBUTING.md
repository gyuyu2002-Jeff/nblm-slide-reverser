# Contributing to NBLM Slide Reverse Engineer

感謝您對本專案感興趣！我們非常歡迎任何 Issue 回饋與 Pull Request 貢獻。

## 開發指南

1. **Fork 本專案** 並 Clone 至您的本地電腦。
2. 建立新分支：
   ```bash
   git checkout -b feature/amazing-feature
   ```
3. 安裝相依套件：
   ```bash
   pip install -r requirements.txt
   ```
4. 啟動測試環境：
   ```bash
   python app.py
   ```
5. 提交您的修改：
   ```bash
   git commit -m "feat: add amazing feature"
   ```
6. 推送至遠端並發起 Pull Request。

## 資安準則

* 請**切勿**在任何提交代碼中包含任何個人的 Google Gemini API Key。
* 請維持零伺服器儲存（BYOK）架構，確保所有終端使用者的資訊安全。
