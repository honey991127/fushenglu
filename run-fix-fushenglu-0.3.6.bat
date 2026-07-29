@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0fix-fushenglu-0.3.6.ps1"
echo.
pause
