@echo off
setlocal EnableExtensions

REM Run from repo root (same folder as this script).
cd /d "%~dp0"

echo Configuring a3hook ^(CMake^)...
pushd a3hook
cmake -B build -S . -DCMAKE_BUILD_TYPE=Release
if errorlevel 1 (
  echo cmake configure failed.
  popd
  exit /b 1
)

echo Building Release...
cmake --build build --config Release
if errorlevel 1 (
  echo cmake build failed.
  popd
  exit /b 1
)
popd

echo Done. Executable is staged next to the mod folder under A3LaunchPad ^(POST_BUILD in a3hook CMakeLists^).