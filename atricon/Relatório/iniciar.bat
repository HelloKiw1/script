@echo off
setlocal
cd /d "%~dp0"
where pyw >nul 2>nul
if not errorlevel 1 (
    start "" pyw -3 "%~dp0web_local.py"
    exit /b
)
where pythonw >nul 2>nul
if not errorlevel 1 (
    start "" pythonw "%~dp0web_local.py"
    exit /b
)
where py >nul 2>nul
if errorlevel 1 (python web_local.py) else (py -3 web_local.py)
if errorlevel 1 pause
