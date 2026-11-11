@echo off
cd /d "%~dp0"
".venv\Scripts\python.exe" lanzar_boxshelf.py
if errorlevel 1 pause
