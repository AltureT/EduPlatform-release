@echo off
rem Banji workbench (Windows double-click entry).
rem This file must stay pure ASCII. Chinese messages are printed through PowerShell from code points.
rem Keep this window open while teaching; closing it stops the console and the platform.
rem Node.js: vendor\node (portable) first, then the system node, each only if its major version is >= 22.
rem   Neither -> ask once; Enter downloads a portable Node into vendor\node (npmmirror.com first, then nodejs.org,
rem   checked against SHASUMS256.txt from the same place). No system PATH change, no admin rights.
rem   EDU_LAUNCHER_DRY_RUN=1: print the Node version and exit as soon as Node is ready (for testing).
rem Exit code 75 from the console = the platform was just updated: check the install again and restart
rem   the console, at most 3 times (so a console that keeps exiting with 75 cannot loop forever).
rem   EDU_LAUNCHER=1 tells the console it was started from here (no "run npm run manage again" hint).
rem Self-copy: cmd.exe re-reads a running .bat by byte offset, and an update overwrites this very file.
rem   So the first thing we do is copy ourselves to %TEMP% under a unique name and run the copy (with --copy
rem   and the folder); the copy is what cmd keeps reading, the original can be replaced freely. The copy
rem   deletes itself on the way out (:finish). If the copy fails (TEMP not writable), run in place with a warning.
rem Launcher log: every step appends one English line to data\logs\launcher.log (:log; renamed to .1 past 1 MB).
rem Troubleshooting file: on failure (no usable Node.js, npm install failed twice, console exit code other than
rem   0 / 75 / 76) :diag runs scripts\launcher-diag.ps1, which writes the file and prints where (in Chinese; the
rem   folder name never passes through cmd). Exit code 76 = the console already wrote one: no second file, no restart.
rem Exit code 77 = the dependencies were installed on another computer (other system or chip, e.g. node_modules copied
rem   from a Mac): delete node_modules\.package-lock.json, better-sqlite3, rolldown and @rolldown, install again (same
rem   mirror retry), run npm rebuild better-sqlite3, start the console again. Only once (NATIVEFIX); a second 77 writes
rem   a troubleshooting file (install) and asks to delete the whole node_modules folder.
rem Folder: pushd, not cd /d. cmd.exe cannot cd into a UNC path (\\server\share\..., e.g. a Mac folder shared
rem   into a Windows VM); pushd maps a temporary drive letter for it. popd in :finish releases that letter.
if /i "%~1"=="--copy" goto copied
set "EDU_LAUNCHER_COPY=%TEMP%\eduplatform-launcher-%RANDOM%%RANDOM%.bat"
copy /y "%~f0" "%EDU_LAUNCHER_COPY%" >nul 2>nul
if errorlevel 1 goto inplace
"%EDU_LAUNCHER_COPY%" --copy "%~dp0."
exit /b

:inplace
echo Warning: could not copy this launcher to the TEMP folder; running it in place. If the platform updates itself, close this window and double-click again.
set "EDU_START=%~dp0"
pushd "%~dp0" || goto cdfail0
goto main

:copied
set "EDU_START=%~2"
pushd "%~2" || goto cdfail

:main
set "EDU_LAUNCHER=1"
title Banji Workbench
set "NODE_VERSION=24.21.0"
set "RESTARTS=0"
set "NATIVEFIX=0"
set "EDU_NATIVE_PENDING="
set "EDU_NODE_WHY=no usable Node.js"
rem The launcher's own folder as double-clicked (in place: dp0; the copy gets it as %~2): a UNC path still shows its \\ here, unlike %CD% after pushd.
call :log "start in %EDU_START%"

rem Leftovers from a download that stopped halfway.
if exist "vendor\node-download.zip" del /f /q "vendor\node-download.zip"
if exist "vendor\node-tmp" rmdir /s /q "vendor\node-tmp"

call :usevendor
if not errorlevel 1 goto havenode
where node >nul 2>nul
if errorlevel 1 goto asknode
call :nodeok node
if not errorlevel 1 goto havenode

:asknode
call :say "0x8FD9,0x53F0,0x7535,0x8111,0x8FD8,0x6CA1,0x6709,0x5E73,0x53F0,0x8981,0x7528,0x7684,0x57FA,0x7840,0x8F6F,0x4EF6,0x20,0x4E,0x6F,0x64,0x65,0x2E,0x6A,0x73,0xFF08,0x6216,0x7248,0x672C,0x592A,0x65E7,0xFF09,0x3002"
echo Node.js 22 or newer was not found on this computer.
call :say "0x6309,0x56DE,0x8F66,0x81EA,0x52A8,0x4E0B,0x8F7D,0x5B89,0x88C5,0xFF08,0x7EA6,0x20,0x35,0x30,0x20,0x4D,0x42,0xFF0C,0x88C5,0x5728,0x5E73,0x53F0,0x6587,0x4EF6,0x5939,0x91CC,0xFF0C,0x4E0D,0x6539,0x52A8,0x7CFB,0x7EDF,0xFF09,0xFF1B"
echo Press Enter to download it automatically (about 50 MB, kept in this folder, no system changes).
call :say "0x4E0D,0x60F3,0x81EA,0x52A8,0x88C5,0x5C31,0x8F93,0x5165,0x20,0x6E,0x20,0x56DE,0x8F66,0xFF0C,0x7136,0x540E,0x81EA,0x5DF1,0x5230,0x20,0x68,0x74,0x74,0x70,0x73,0x3A,0x2F,0x2F,0x6E,0x6F,0x64,0x65,0x6A,0x73,0x2E,0x6F,0x72,0x67,0x2F,0x7A,0x68,0x2D,0x63,0x6E,0x20,0x5B89,0x88C5,0x540E,0x518D,0x53CC,0x51FB,0x672C,0x6587,0x4EF6,0x3002"
echo Or type n and press Enter, install it yourself from https://nodejs.org/zh-cn, then double-click this file again.
set "ANSWER="
set /p "ANSWER=> "
if not defined ANSWER goto installnode
set "ANSWER=%ANSWER:"=%"
if /i "%ANSWER%"=="y" goto installnode
set "EDU_NODE_WHY=declined the automatic Node.js download"
goto nonode

:installnode
set "NODE_ARCH=win-x64"
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "NODE_ARCH=win-arm64"
if /i "%PROCESSOR_ARCHITEW6432%"=="ARM64" set "NODE_ARCH=win-arm64"
rem Real 32-bit Windows: there is no portable Node for it, so show the manual install text instead.
if /i "%PROCESSOR_ARCHITECTURE%"=="x86" if not defined PROCESSOR_ARCHITEW6432 set "EDU_NODE_WHY=32-bit Windows, no portable Node.js"
if /i "%PROCESSOR_ARCHITECTURE%"=="x86" if not defined PROCESSOR_ARCHITEW6432 goto nonode
call :log "downloading portable Node.js %NODE_VERSION%"
if not exist "vendor" mkdir "vendor"
call :say "0x6B63,0x5728,0x4ECE,0x56FD,0x5185,0x955C,0x50CF,0x4E0B,0x8F7D,0x20,0x4E,0x6F,0x64,0x65,0x2E,0x6A,0x73,0x2026"
echo Downloading Node.js %NODE_VERSION% from npmmirror.com...
set "NODE_BASE=https://npmmirror.com/mirrors/node/v%NODE_VERSION%"
call :fetchnode
if not errorlevel 1 goto nodeinstalled
call :say "0x6362,0x5B98,0x65B9,0x5730,0x5740,0x518D,0x8BD5,0x4E00,0x6B21,0x2026"
echo Retrying from nodejs.org...
set "NODE_BASE=https://nodejs.org/dist/v%NODE_VERSION%"
call :fetchnode
if not errorlevel 1 goto nodeinstalled

:nodefail
set "EDU_NODE_WHY=portable Node.js download failed"
echo.
call :say "0x4E0B,0x8F7D,0x5931,0x8D25,0x3002"
echo Download failed.
goto nonode

:nodeinstalled
call :usevendor
if errorlevel 1 goto nodefail
"vendor\node\node.exe" -v
call :say "0x4E,0x6F,0x64,0x65,0x2E,0x6A,0x73,0x20,0x5DF2,0x88C5,0x5230,0x5E73,0x53F0,0x6587,0x4EF6,0x5939,0xFF0C,0x4EE5,0x540E,0x53CC,0x51FB,0x672C,0x6587,0x4EF6,0x76F4,0x63A5,0x7528"
echo Node.js is now kept in this folder and will be used from now on.

:havenode
set "EDU_NODE_EXE="
for /f "delims=" %%p in ('where node 2^>nul') do if not defined EDU_NODE_EXE set "EDU_NODE_EXE=%%p"
set "EDU_NODE_VER="
for /f "delims=" %%v in ('node -v 2^>nul') do set "EDU_NODE_VER=%%v"
call :log "node %EDU_NODE_EXE% %EDU_NODE_VER%"
if "%EDU_LAUNCHER_DRY_RUN%"=="1" goto dryrun

:checkinstall
rem Installed = npm finished (node_modules\.package-lock.json) and the better-sqlite3 binary is in place.
if not exist "node_modules\.package-lock.json" goto install
if not exist "node_modules\better-sqlite3\build\Release\better_sqlite3.node" goto install
goto run

:install
rem better-sqlite3 without its binary: remove it so npm installs it again and fetches the binary.
if exist "node_modules\better-sqlite3\package.json" if not exist "node_modules\better-sqlite3\build\Release\better_sqlite3.node" rmdir /s /q "node_modules\better-sqlite3"
if defined EDU_NATIVE_PENDING goto installnow
if %RESTARTS% GTR 0 goto installupdated
call :say "0x7B2C,0x4E00,0x6B21,0x4F7F,0x7528,0xFF0C,0x6B63,0x5728,0x5B89,0x88C5,0x4F9D,0x8D56,0xFF08,0x9700,0x8981,0x8054,0x7F51,0xFF0C,0x7EA6,0x51E0,0x5206,0x949F,0xFF09,0x2026"
echo First run: installing dependencies (needs internet, a few minutes)...
goto installnow
:installupdated
call :say "0x5E73,0x53F0,0x5DF2,0x66F4,0x65B0,0xFF0C,0x6B63,0x5728,0x91CD,0x65B0,0x5B89,0x88C5,0x4F9D,0x8D56,0x2026"
echo The platform was updated: installing dependencies again...
:installnow
call :log "npm install start"
call npm install
if not errorlevel 1 goto installok

rem Retry once through the npmmirror.com mirror (registry and the better-sqlite3 binary). No .npmrc is written.
call :log "npm install failed; retrying with https://registry.npmmirror.com"
echo.
call :say "0x6362,0x56FD,0x5185,0x6E90,0x518D,0x8BD5,0x4E00,0x6B21,0x2026"
echo npm install failed. Retrying once with the npmmirror.com mirror...
set "npm_config_registry=https://registry.npmmirror.com"
set "npm_config_better_sqlite3_binary_host_mirror=https://registry.npmmirror.com/-/binary/better-sqlite3"
call npm install
if errorlevel 1 goto installfail
set "npm_config_registry="
set "npm_config_better_sqlite3_binary_host_mirror="
:installok
call :log "npm install ok"
if not defined EDU_NATIVE_PENDING goto run
set "EDU_NATIVE_PENDING="
call :log "npm rebuild better-sqlite3"
call npm rebuild better-sqlite3
:run
call :log "npm run manage"
call npm run manage
set "MCODE=%ERRORLEVEL%"
call :log "npm run manage exited with code %MCODE%"
if "%MCODE%"=="76" goto diagdone
if "%MCODE%"=="77" goto nativemismatch
if not "%MCODE%"=="75" goto afterrun
if %RESTARTS% GEQ 3 goto afterrun
set /a "RESTARTS=RESTARTS+1"
echo.
call :say "0x5E73,0x53F0,0x5DF2,0x66F4,0x65B0,0xFF0C,0x6B63,0x5728,0x91CD,0x65B0,0x542F,0x52A8,0x5DE5,0x4F5C,0x53F0,0x2026"
echo The platform was updated. Restarting the console...
goto checkinstall

rem Exit code 77: dependencies from another computer. Remove only the packages with native parts, then install again (once).
:nativemismatch
if "%NATIVEFIX%"=="1" goto nativefail
set "NATIVEFIX=1"
set "EDU_NATIVE_PENDING=1"
echo.
call :say "0x4F9D,0x8D56,0x548C,0x8FD9,0x53F0,0x7535,0x8111,0x4E0D,0x914D,0xFF0C,0x6B63,0x5728,0x91CD,0x65B0,0x5B89,0x88C5,0x2026"
echo The dependencies were installed on another computer and do not fit this one. Installing them again...
call :log "native modules do not match this computer; reinstalling"
if exist "node_modules\.package-lock.json" del /f /q "node_modules\.package-lock.json"
if exist "node_modules\better-sqlite3" rmdir /s /q "node_modules\better-sqlite3"
if exist "node_modules\rolldown" rmdir /s /q "node_modules\rolldown"
if exist "node_modules\@rolldown" rmdir /s /q "node_modules\@rolldown"
goto checkinstall

:afterrun
if "%MCODE%"=="0" goto afterrunpause
if "%MCODE%"=="75" goto afterrunpause
call :diag manage "Workbench exited with code %MCODE%"
:afterrunpause
echo.
pause
set "CODE=0"
goto finish

rem Exit code 76: the console has already written its troubleshooting file. Not an error loop: no restart, no second file.
:diagdone
echo.
call :say "0x5DE5,0x4F5C,0x53F0,0x5DF2,0x9000,0x51FA,0xFF0C,0x6392,0x969C,0x6587,0x4EF6,0x89C1,0x20,0x6392,0x969C,0x20,0x6587,0x4EF6,0x5939"
echo The console has exited. Its troubleshooting file is in the troubleshooting folder inside this folder.
pause
set "CODE=1"
goto finish

rem Exit code 77 again after reinstalling: give up, write a troubleshooting file.
:nativefail
echo.
call :say "0x91CD,0x88C5,0x540E,0x4ECD,0x4E0D,0x80FD,0x7528,0xFF0C,0x8BF7,0x628A,0x20,0x6E,0x6F,0x64,0x65,0x5F,0x6D,0x6F,0x64,0x75,0x6C,0x65,0x73,0x20,0x6587,0x4EF6,0x5939,0x6574,0x4E2A,0x5220,0x6389,0x518D,0x53CC,0x51FB"
echo Still not usable after reinstalling. Delete the whole node_modules folder and double-click this file again.
call :log "native modules still do not match after reinstalling"
call :diag install "Dependencies still do not match this computer after reinstalling (exit code 77)"
echo.
pause
set "CODE=1"
goto finish

:dryrun
node -v
set "CODE=0"
goto finish

:nonode
call :say "0x8BF7,0x5148,0x5B89,0x88C5,0x20,0x4E,0x6F,0x64,0x65,0x2E,0x6A,0x73,0x20,0x32,0x32,0x20,0x6216,0x20,0x32,0x34,0xFF1A"
echo Please install Node.js 22 or 24: https://nodejs.org/zh-cn
echo Mirror in China: https://npmmirror.com/mirrors/node/
call :log "%EDU_NODE_WHY%"
call :diag node "%EDU_NODE_WHY%"
echo.
pause
set "CODE=1"
goto finish

:installfail
echo.
call :say "0x5B89,0x88C5,0x5931,0x8D25,0xFF1A,0x8BF7,0x68C0,0x67E5,0x7F51,0x7EDC,0xFF0C,0x6216,0x8BA9,0x540C,0x4E8B,0x628A,0x6574,0x4E2A,0x20,0x6E,0x6F,0x64,0x65,0x5F,0x6D,0x6F,0x64,0x75,0x6C,0x65,0x73,0x20,0x6587,0x4EF6,0x5939,0x62F7,0x7ED9,0x4F60,0xFF08,0x653E,0x8FDB,0x672C,0x6587,0x4EF6,0x5939,0xFF09,0x540E,0x518D,0x53CC,0x51FB,0x672C,0x6587,0x4EF6,0x3002"
echo npm install failed. Check the network, or copy the whole node_modules folder from a colleague into this folder.
call :log "npm install failed again (mirror)"
call :diag install "npm install failed twice (default registry and npmmirror)"
echo.
pause
set "CODE=1"
goto finish

rem Could not change into the platform folder (moved or renamed? a share that even pushd cannot map?): do not install anything in TEMP.
:cdfail0
set "EDU_FOLDER=%~dp0"
goto cdfailmsg
:cdfail
set "EDU_FOLDER=%~2"
:cdfailmsg
call :say "0x6253,0x4E0D,0x5F00,0x5E73,0x53F0,0x6587,0x4EF6,0x5939,0x3002,0x5982,0x679C,0x5B83,0x5728,0x7F51,0x7EDC,0x76D8,0x6216,0x5171,0x4EAB,0x6587,0x4EF6,0x5939,0x91CC,0xFF08,0x8DEF,0x5F84,0x4EE5,0x20,0x5C,0x5C,0x20,0x5F00,0x5934,0xFF09,0xFF0C,0x8BF7,0x628A,0x6574,0x4E2A,0x6587,0x4EF6,0x5939,0x62F7,0x5230,0x8FD9,0x53F0,0x7535,0x8111,0x7684,0x78C1,0x76D8,0x4E0A,0xFF08,0x6BD4,0x5982,0x684C,0x9762,0xFF09,0xFF0C,0x518D,0x53CC,0x51FB,0x3002"
echo Could not open the platform folder "%EDU_FOLDER%". If it is on a network or shared drive (path starts with \\), copy the whole folder to this computer (for example the Desktop) and double-click the launcher there.
pause
set "CODE=1"
goto finish

rem Main exits come here. A copy in TEMP deletes itself: "(goto)" ends this batch first, so the file is not in use.
:finish
popd 2>nul
if not "%~1"=="--copy" exit /b %CODE%
(goto) 2>nul & del "%~f0"

rem Append one English line to data\logs\launcher.log; past 1 MB it is renamed to launcher.log.1 first. Never fails the launcher.
rem The text goes through a variable and is echoed inside double quotes, so a folder name with & or ( ) cannot break the line.
:log
if not exist "data\logs" mkdir "data\logs" >nul 2>nul
if exist "data\logs\launcher.log" for %%F in ("data\logs\launcher.log") do if %%~zF GTR 1048576 move /y "data\logs\launcher.log" "data\logs\launcher.log.1" >nul 2>nul
set "EDU_LOGLINE=%~1"
>>"data\logs\launcher.log" 2>nul echo [%DATE% %TIME%] "%EDU_LOGLINE%"
exit /b 0

rem Write a troubleshooting file: %1 = install, node or manage; %2 = English one-liner (goes into its details).
rem scripts\launcher-diag.ps1 maps the stage to the Chinese name, writes the file and prints where it is.
:diag
if not exist "scripts\launcher-diag.ps1" exit /b 0
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\launcher-diag.ps1 -Stage %~1 -Message "%~2"
exit /b 0

rem errorlevel 0 when vendor\node\node.exe runs with major version >= 22; then vendor\node goes first on PATH.
:usevendor
if not exist "vendor\node\node.exe" exit /b 1
call :nodeok vendor\node\node.exe
if errorlevel 1 exit /b 1
set "PATH=%CD%\vendor\node;%PATH%"
exit /b 0

rem errorlevel 0 when "%~1 -v" prints a major version >= 22 (e.g. v24.21.0).
:nodeok
set "NODE_MAJOR="
for /f "tokens=1 delims=." %%v in ('%~1 -v 2^>nul') do set "NODE_MAJOR=%%v"
if not defined NODE_MAJOR exit /b 1
set "NODE_MAJOR=%NODE_MAJOR:v=%"
set /a "NODE_MAJOR=NODE_MAJOR+0" >nul 2>nul
if %NODE_MAJOR% GEQ 22 exit /b 0
exit /b 1

rem Download node-v<V>-<arch>.zip from NODE_BASE and check it against SHASUMS256.txt from the same place
rem (PowerShell exits 2 on a checksum mismatch), then unzip into vendor\node-tmp and move its only folder
rem to vendor\node (retried: antivirus may hold the folder for a moment). errorlevel 1 on any failure.
rem The progress bar is off: Windows PowerShell 5.1 downloads several times slower while drawing it.
:fetchnode
call :say "0x6B63,0x5728,0x4E0B,0x8F7D,0xFF0C,0x7EA6,0x20,0x31,0x2013,0x33,0x20,0x5206,0x949F,0xFF0C,0x8BF7,0x522B,0x5173,0x7A97,0x53E3"
echo Downloading, about 1-3 minutes. Please keep this window open.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; $ErrorActionPreference='Stop'; $zip='vendor\node-download.zip'; $f='node-v'+$env:NODE_VERSION+'-'+$env:NODE_ARCH+'.zip'; try { [Net.ServicePointManager]::SecurityProtocol=[Net.ServicePointManager]::SecurityProtocol -bor 3072; Invoke-WebRequest -UseBasicParsing -Uri ($env:NODE_BASE+'/'+$f) -OutFile $zip; $c=(Invoke-WebRequest -UseBasicParsing -Uri ($env:NODE_BASE+'/SHASUMS256.txt')).Content; if ($c -is [byte[]]) { $c=[Text.Encoding]::ASCII.GetString($c) }; $want=''; foreach ($l in ($c -split [char]10)) { $p=@($l.Trim() -split '\s+'); if ($p.Count -eq 2 -and $p[1] -eq $f) { $want=$p[0] } }; $got=(Get-FileHash -Algorithm SHA256 -Path $zip).Hash; if (-not $want -or $got -ne $want) { Remove-Item -Force -ErrorAction SilentlyContinue $zip; exit 2 }; exit 0 } catch { Write-Host ('Failed: '+$_.Exception.Message); Remove-Item -Force -ErrorAction SilentlyContinue $zip; exit 1 }"
if errorlevel 2 goto fetchbadsum
if errorlevel 1 exit /b 1
call :say "0x6821,0x9A8C,0x901A,0x8FC7,0xFF0C,0x6B63,0x5728,0x89E3,0x538B,0x2026"
echo SHA256 OK, unpacking...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; $ErrorActionPreference='Stop'; $zip='vendor\node-download.zip'; $tmp='vendor\node-tmp'; try { if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }; Expand-Archive -Path $zip -DestinationPath $tmp -Force; $d=@(Get-ChildItem -Path $tmp -Directory); if ($d.Count -ne 1) { throw 'unexpected zip layout' }; if (Test-Path 'vendor\node') { Remove-Item -Recurse -Force 'vendor\node' }; $ok=$false; for ($i=0; $i -lt 4; $i++) { try { Move-Item -Path $d[0].FullName -Destination 'vendor\node'; $ok=$true; break } catch { Start-Sleep 2 } }; if (-not $ok) { throw 'cannot move the unpacked folder to vendor\node' }; Remove-Item -Recurse -Force $tmp; Remove-Item -Force $zip; exit 0 } catch { Write-Host ('Failed: '+$_.Exception.Message); Remove-Item -Force -ErrorAction SilentlyContinue $zip; Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp; exit 1 }"
if errorlevel 1 exit /b 1
exit /b 0

:fetchbadsum
call :say "0x4E0B,0x8F7D,0x7684,0x6587,0x4EF6,0x6821,0x9A8C,0x6CA1,0x901A,0x8FC7,0x3002"
echo The downloaded file does not match SHASUMS256.txt.
exit /b 1

:say
powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host (-join [char[]](%~1))" 2>nul
exit /b 0
