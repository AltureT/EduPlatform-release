@echo off
rem Classroom platform - management console (Windows double-click entry).
rem This file must stay pure ASCII. Chinese messages are printed through PowerShell from code points.
rem Keep this window open while teaching; closing it stops the console and the platform.
cd /d "%~dp0"
title Classroom Platform

where node >nul 2>nul
if errorlevel 1 goto nonode

rem Installed = npm finished (node_modules\.package-lock.json) and the better-sqlite3 binary is in place.
if not exist "node_modules\.package-lock.json" goto install
if not exist "node_modules\better-sqlite3\build\Release\better_sqlite3.node" goto install
goto run

:install
rem better-sqlite3 without its binary: remove it so npm installs it again and fetches the binary.
if exist "node_modules\better-sqlite3\package.json" if not exist "node_modules\better-sqlite3\build\Release\better_sqlite3.node" rmdir /s /q "node_modules\better-sqlite3"
call :say "0x7B2C,0x4E00,0x6B21,0x4F7F,0x7528,0xFF0C,0x6B63,0x5728,0x5B89,0x88C5,0x4F9D,0x8D56,0xFF08,0x9700,0x8981,0x8054,0x7F51,0xFF0C,0x7EA6,0x51E0,0x5206,0x949F,0xFF09,0x2026"
echo First run: installing dependencies (needs internet, a few minutes)...
call npm install
if not errorlevel 1 goto run

rem Retry once through the npmmirror.com mirror (registry and the better-sqlite3 binary). No .npmrc is written.
echo.
call :say "0x6362,0x56FD,0x5185,0x6E90,0x518D,0x8BD5,0x4E00,0x6B21,0x2026"
echo npm install failed. Retrying once with the npmmirror.com mirror...
set "npm_config_registry=https://registry.npmmirror.com"
set "npm_config_better_sqlite3_binary_host_mirror=https://registry.npmmirror.com/-/binary/better-sqlite3"
call npm install
if errorlevel 1 goto installfail
set "npm_config_registry="
set "npm_config_better_sqlite3_binary_host_mirror="

:run
call npm run manage
echo.
pause
exit /b 0

:nonode
call :say "0x8BF7,0x5148,0x5B89,0x88C5,0x20,0x4E,0x6F,0x64,0x65,0x2E,0x6A,0x73,0x20,0x32,0x32,0x20,0x6216,0x20,0x32,0x34,0xFF1A"
echo Please install Node.js 22 or 24: https://nodejs.org/zh-cn
echo Mirror in China: https://npmmirror.com/mirrors/node/
echo.
pause
exit /b 1

:installfail
echo.
call :say "0x5B89,0x88C5,0x5931,0x8D25,0xFF1A,0x8BF7,0x68C0,0x67E5,0x7F51,0x7EDC,0xFF0C,0x6216,0x8BA9,0x540C,0x4E8B,0x628A,0x6574,0x4E2A,0x20,0x6E,0x6F,0x64,0x65,0x5F,0x6D,0x6F,0x64,0x75,0x6C,0x65,0x73,0x20,0x6587,0x4EF6,0x5939,0x62F7,0x7ED9,0x4F60,0xFF08,0x653E,0x8FDB,0x672C,0x6587,0x4EF6,0x5939,0xFF09,0x540E,0x518D,0x53CC,0x51FB,0x672C,0x6587,0x4EF6,0x3002"
echo npm install failed. Check the network, or copy the whole node_modules folder from a colleague into this folder.
echo.
pause
exit /b 1

:say
powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host (-join [char[]](%~1))" 2>nul
exit /b 0
