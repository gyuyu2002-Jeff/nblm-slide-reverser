@echo off
chcp 65001 >nul
title NBLM Auto-Pilot 投影片全自動閉環優化器
cd /d "%~dp0"

echo =====================================================================
echo    🤖 NBLM Auto-Pilot 全自動投影片逆向與生成閉環測試系統
echo =====================================================================
echo.
echo [檢查中] 正在啟動 Python 引擎...
echo.

python nblm_pilot.py

if %ERRORLEVEL% neq 0 (
    echo.
    echo [提示] 執行過程中發生錯誤或被中斷。
)

echo.
echo 按任意鍵結束...
pause >nul
