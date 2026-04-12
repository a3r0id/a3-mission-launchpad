@echo off
setlocal
cd /d "%~dp0"
if not exist "launchpad_client\dist\index.html" (
  echo ERROR: Missing launchpad_client\dist. Run: cd launchpad_client ^&^& npm run build
  exit /b 1
)
if not exist "packaging\splash.png" (
  echo ERROR: Missing packaging\splash.png ^(PNG splash for PyInstaller^)
  exit /b 1
)
pyinstaller --noconfirm --distpath bin --workpath build launchpad.spec
