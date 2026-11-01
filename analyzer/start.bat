@echo off
rem Analyseur BuBuTravel : installe son environnement au premier lancement, puis tourne en continu.
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Installation de l'environnement Python...
  py -3 -m venv .venv || python -m venv .venv
  ".venv\Scripts\python.exe" -m pip install --upgrade pip >nul
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
)
if not exist ".env" (
  echo Le fichier .env manque : copiez .env.example en .env et remplissez les cles.
  pause
  exit /b 1
)
:loop
".venv\Scripts\python.exe" analyzer.py
echo L'analyseur s'est arrete, redemarrage dans 10 secondes...
timeout /t 10 >nul
goto loop
