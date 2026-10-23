@echo off
chcp 65001 >nul
title NBLM Auto-Pilot 投影片全自動閉環優化器
cd /d "%~dp0"

echo =====================================================================
echo    NBLM Auto-Pilot 投影片全自動閉環優化器
echo =====================================================================
echo.
echo [頁數設定說明]
echo  - 直接按 [Enter]：採用 config.json 預設值 (目前預設 6 頁)
echo  - 輸入數字 (例如 10、15、20)：辨識指定的投影片頁數
echo  - 輸入 0 或 all：辨識整份簡報【全部頁面】(不設上限)
echo.
set USER_PAGES=
set /p USER_PAGES="👉 請輸入要辨識的頁數 [直接按 Enter 採用預設]: "

set ARGS=
if not "%USER_PAGES%"=="" (
    set ARGS=--limit %USER_PAGES%
)

echo.
echo [系統] 啟動 Python 引擎執行閉環流程 %ARGS%...
echo.

python -u nblm_pilot.py %ARGS%
set EXIT_CODE=%ERRORLEVEL%

if %EXIT_CODE% neq 0 (
    echo.
    echo [提示] 執行過程中發生異常 (Exit Code: %EXIT_CODE%)。
) else (
    echo.
    echo [完成] 執行結束，狀態碼正常。
)

echo.
pause
