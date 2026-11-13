@echo off
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (python relatorio.py --instalar) else (py -3 relatorio.py --instalar)
pause
