@echo off
chcp 65001 >nul
title NBLM 簡報風格逆向器 - 推送至 GitHub
cd /d "%~dp0"

echo ========================================================
echo   🚀 NBLM 簡報風格逆向器 - 一鍵發布至 GitHub
echo ========================================================
echo.
echo 請先在 GitHub 上建立一個全新的空倉庫（Repository）：
echo 網址例如：https://github.com/您的帳號/nblm-slide-reverser.git
echo.
set /p REPO_URL="請貼上您的 GitHub 倉庫網址: "

if "%REPO_URL%"=="" (
    echo.
    echo [錯誤] 未輸入倉庫網址，操作已取消。
    pause
    exit /b
)

echo.
echo [1/5] 檢查 Git 本地倉庫...
if not exist ".git" (
    git init
    echo 已初始化 Git 倉庫。
)

echo.
echo [2/5] 檢查安全忽略名單 (.gitignore)...
echo 確保任何敏感設定檔與金鑰不會被推送。

echo.
echo [3/5] 加入檔案並提交...
git add .
git commit -m "feat: initial open-source release of NBLM presentation style reverse engineer"

echo.
echo [4/5] 設定主分支為 main...
git branch -M main

echo.
echo [5/5] 設定遠端倉庫並推送...
git remote remove origin 2>nul
git remote add origin %REPO_URL%
git push -u origin main

echo.
echo ========================================================
echo   ✅ 發布流程執行完成！請至 GitHub 頁面查看您的倉庫。
echo ========================================================
pause
