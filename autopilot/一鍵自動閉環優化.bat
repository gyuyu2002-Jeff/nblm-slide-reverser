@echo off
chcp 65001 >nul
title NBLM Auto-Pilot 投影片全自動閉環優化器
cd /d "%~dp0"

echo =====================================================================
echo    NBLM Auto-Pilot 投影片全自動閉環優化器
echo =====================================================================
echo.
echo [系統] 啟動 Python 引擎執行閉環流程...
echo.

python -u nblm_pilot.py
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
