@echo off
setlocal EnableExtensions

REM Run from repo root (same folder as this script).
cd /d "%~dp0"

set "STAGING_DIR=A3LaunchPad"
set "HEMTT_ADDONS=launchpad_mod\.hemttout\build\addons"
set "DEST_ADDONS=%STAGING_DIR%\mod\addons"

echo Building companion mod ^(HEMTT^)...
pushd launchpad_mod
hemtt build
if errorlevel 1 (
  echo hemtt build failed.
  popd
  exit /b 1
)
popd

if not exist "%HEMTT_ADDONS%" (
  echo HEMTT output not found: %HEMTT_ADDONS%
  echo Run from repo root after a successful hemtt build.
  exit /b 1
)

if not exist "%DEST_ADDONS%" mkdir "%DEST_ADDONS%"

echo Staging addons to %DEST_ADDONS% ...
xcopy /Y /E /I "%HEMTT_ADDONS%\*" "%DEST_ADDONS%\"

echo Done.
