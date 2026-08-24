@echo off
cd /d "%~dp0"
title DocKit server
python "%~dp0serve.py" %1
if errorlevel 1 pause
