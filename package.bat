@echo off
setlocal
cd /d "%~dp0"
if not exist "launchpad_client\dist\index.html" (
  echo ERROR: Missing launchpad_client\dist. Run: cd launchpad_client ^&^& npm run build
  exit /b 1
)
if not exist "launchpad_client\src\assets\hero.png" (
  echo ERROR: Missing launchpad_client\src\assets\hero.png ^(PNG splash for PyInstaller^)
  exit /b 1
)
if not exist "icon.png" (
  echo ERROR: Missing icon.png ^(EXE icon; converted to .ico during PyInstaller^)
  exit /b 1
)
python -c "import PIL" 2>nul
if errorlevel 1 (
  echo ERROR: Pillow is required to convert icon.png to .ico. Run: pip install Pillow
  exit /b 1
)
rem PyInstaller deletes bin\A3MissionLaunchpad before COLLECT; locked DLLs ^(e.g. libcrypto-3.dll^)
rem cause PermissionError if the packaged EXE is still running. Close it first.
echo Closing A3MissionLaunchpad.exe if it is running...
taskkill /IM A3MissionLaunchpad.exe /F >nul 2>&1
timeout /t 2 /nobreak >nul
pyinstaller --noconfirm --distpath bin --workpath build launchpad.spec
