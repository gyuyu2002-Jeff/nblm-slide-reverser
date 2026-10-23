@echo off
chcp 65001 >nul
title NBLM Auto-Pilot
cd /d "%~dp0"

python -u nblm_pilot.py %*
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Python execution exited with error code %ERRORLEVEL%.
    pause
)
