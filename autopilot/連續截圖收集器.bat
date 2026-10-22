@echo off
chcp 65001 >nul
title NBLM 投影片連續截圖自動收集器
cd /d "%~dp0"

echo =====================================================================
echo    📸 NBLM 投影片連續截圖自動收集器
echo =====================================================================
echo.
echo [系統] 啟動剪貼簿截圖監聽器...
echo.

python -u clip_collector.py
set EXIT_CODE=%ERRORLEVEL%

if %EXIT_CODE% neq 0 (
    echo.
    echo [提示] 執行結束 (Exit Code: %EXIT_CODE%)。
)

echo.
echo 請按任意鍵關閉視窗...
pause >nul
