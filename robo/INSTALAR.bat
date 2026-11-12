@echo off
chcp 65001 >nul
title Instalador do robo do saldo
powershell -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0instalar-robo.ps1"
echo.
pause
