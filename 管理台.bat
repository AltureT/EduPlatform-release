@echo off
rem Classroom platform - management console (Windows double-click entry).
rem This file must stay pure ASCII. Chinese messages are printed through PowerShell from code points.
rem Keep this window open while teaching; closing it stops the console and the platform.
cd /d "%~dp0"
title Classroom Platform

where node >nul 2>nul
if errorlevel 1 goto nonode

if exist node_modules goto run
call :say "0x7B2C,0x4E00,0x6B21,0x4F7F,0x7528,0xFF0C,0x6B63,0x5728,0x5B89,0x88C5,0x4F9D,0x8D56,0xFF08,0x9700,0x8981,0x8054,0x7F51,0xFF0C,0x7EA6,0x51E0,0x5206,0x949F,0xFF09,0x2026"
echo First run: installing dependencies (needs internet, a few minutes)...
call npm install
if errorlevel 1 goto installfail

:run
call npm run manage
echo.
pause
exit /b 0

:nonode
call :say "0x8BF7,0x5148,0x5B89,0x88C5,0x20,0x4E,0x6F,0x64,0x65,0x2E,0x6A,0x73,0x20,0x32,0x32,0x20,0x6216,0x20,0x32,0x34,0xFF1A"
echo Please install Node.js 22 or 24: https://nodejs.org/zh-cn
echo.
pause
exit /b 1

:installfail
call :say "0x5B89,0x88C5,0x5931,0x8D25,0xFF0C,0x8BF7,0x68C0,0x67E5,0x7F51,0x7EDC,0x540E,0x91CD,0x65B0,0x53CC,0x51FB,0x3002"
echo npm install failed. Check the network and double-click this file again.
echo.
pause
exit /b 1

:say
powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host (-join [char[]](%~1))" 2>nul
exit /b 0
