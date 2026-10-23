@echo off
cd /d "%~dp0"
if not exist "release\EmbedMerge\EmbedMerge.exe" (
  echo EmbedMerge.exe was not found. Run npm install and npm run package.
  pause
  exit /b 1
)
start "" "%~dp0release\EmbedMerge\EmbedMerge.exe"
if errorlevel 1 (
  echo Could not start EmbedMerge. See release\EmbedMerge\data\logs.
  pause
)
