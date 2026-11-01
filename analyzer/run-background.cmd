@echo off
rem Analyseur en arriere-plan (sans fenetre), journal dans analyzer.log.
rem Lance par le demarrage de Windows ou par WMI ; redemarre tout seul s'il s'arrete.
cd /d "%~dp0"
:loop
echo ==== demarrage %date% %time% >> analyzer.log
".venv\Scripts\python.exe" -u analyzer.py >> analyzer.log 2>&1
timeout /t 15 /nobreak >nul
goto loop
