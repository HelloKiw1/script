@echo off
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (python relatorio.py) else (py -3 relatorio.py)
if errorlevel 1 pause
