@echo off
chcp 65001 >nul
title Instalador do robo das movimentacoes
powershell -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0instalar-movimentos.ps1"
echo.
pause
