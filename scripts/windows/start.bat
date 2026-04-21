@echo off
chcp 65001 >nul 2>&1
title Hello Agent

set SCRIPT_DIR=%~dp0
set DATA_DIR=%SCRIPT_DIR%Data
set NODE_PATH=%DATA_DIR%\node_modules
set HELLO_AGENT_PORT=3000

if not exist "%DATA_DIR%\logs" mkdir "%DATA_DIR%\logs"

start /b node "%DATA_DIR%\core\main.js" > "%DATA_DIR%\logs\hello-agent.log" 2>&1

:wait_server
timeout /t 1 /nobreak >nul
curl -s http://localhost:3000 >nul 2>&1
if errorlevel 1 goto wait_server

start http://localhost:3000
