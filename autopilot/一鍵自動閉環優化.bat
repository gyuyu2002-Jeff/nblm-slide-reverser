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
echo  - 輸入數字 (例如 10、12、16、20)：辨識指定的投影片頁數
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
    echo ---------------------------------------------------------------------
    echo [提示] 執行過程中發生異常 (Exit Code: %EXIT_CODE%)。
    echo ---------------------------------------------------------------------
) else (
    echo.
    echo ---------------------------------------------------------------------
    echo [完成] 閉環流程全數執行完畢！
    echo ---------------------------------------------------------------------
)

:RESULT_MENU
echo.
echo =====================================================================
echo  📌 視窗已為您保持開啟，供您檢視上方 AI 質檢與對比評分！
echo =====================================================================
echo  [檢視與操作選項]
echo   [1] 開啟「本次完整 AI 視覺評估與評分報告」(Markdown 檔案)
echo   [2] 開啟「NotebookLM 生成投影片截圖」資料夾
echo   [3] 開啟「原始輸入投影片抽樣」資料夾
echo   [Q] 關閉此視窗
echo =====================================================================
set CHOICE=
set /p CHOICE="👉 請輸入選項 [1/2/3/Q，按 Enter 保持視窗開啟]: "

if /i "%CHOICE%"=="1" (
    start "" "%~dp0output\04_evaluations\evaluation_report.md"
    goto RESULT_MENU
)
if /i "%CHOICE%"=="2" (
    start "" "%~dp0output\03_nblm_slides"
    goto RESULT_MENU
)
if /i "%CHOICE%"=="3" (
    start "" "%~dp0output\01_extracted"
    goto RESULT_MENU
)
if /i "%CHOICE%"=="q" exit /b 0

goto RESULT_MENU
