@echo off
chcp 65001 >nul
title NotebookLM 自動化專用 Chrome 啟動器
echo =====================================================================
echo    🚀 NotebookLM 自動化專用 Chrome (遠端除錯端口 9222)
echo =====================================================================
echo.
echo [說明]
echo  1. 此批次檔會啟動一個獨立設定檔的 Chrome 瀏覽器 (端口 9222)。
echo  2. 不會影響您平時正在使用的 Chrome，也不會關閉您的日常分頁。
echo  3. 首次開啟時，請在彈出的視窗中登入一次您的 Google 帳號。
echo  4. 登入後，後續執行「一鍵自動閉環優化」即可全程免密碼自動操作！
echo.

set PROFILE_DIR=%LOCALAPPDATA%\Google\Chrome\AutomationProfile
if not exist "%PROFILE_DIR%" mkdir "%PROFILE_DIR%"

set CHROME_PATH=
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe"
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
) else (
    set "CHROME_PATH=chrome.exe"
)

echo [啟動] 正在開啟 Chrome...
start "" "%CHROME_PATH%" --remote-debugging-port=9222 --user-data-dir="%PROFILE_DIR%" "https://notebooklm.google.com/"

echo [完成] Chrome 已在背景或新視窗啟動！
echo.
echo 請確認 Chrome 視窗已打開並登入 Google 帳號。
echo 登入完畢後，即可關閉此視窗，並執行「一鍵自動閉環優化.bat」。
echo.
pause
