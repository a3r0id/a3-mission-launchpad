@echo off
setlocal
cd ..
python package.py package
cd scripts
exit /b %ERRORLEVEL%
