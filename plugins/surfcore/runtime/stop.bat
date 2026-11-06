@echo off
cd /d "%~dp0"
if exist service.pid (
  for /f "usebackq delims=" %%p in ("service.pid") do taskkill /PID %%p /T /F >nul 2>nul
  del service.pid >nul 2>nul
)
