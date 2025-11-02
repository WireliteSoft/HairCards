@echo off
setlocal

REM Simple wrapper to run the PowerShell backup with retention 50
REM Run from project root

set PS=powershell -NoProfile -ExecutionPolicy Bypass
%PS% -File "%~dp0backup\backup.ps1" -Retention 50

endlocal
