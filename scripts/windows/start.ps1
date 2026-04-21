#!/usr/bin/env pwsh
$ErrorActionPreference = "SilentlyContinue"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DataDir = Join-Path $ScriptDir "Data"
$NodePath = Join-Path $DataDir "node_modules"
$LogFile = Join-Path $DataDir "logs\hello-agent.log"

$env:NODE_PATH = $NodePath
$env:HELLO_AGENT_PORT = "3000"

if (-not (Test-Path (Join-Path $DataDir "logs"))) {
    New-Item -ItemType Directory -Path (Join-Path $DataDir "logs") | Out-Null
}

$proc = Start-Process -FilePath "node" -ArgumentList (Join-Path $DataDir "core\main.js") -RedirectStandardOutput $LogFile -RedirectStandardError (Join-Path $DataDir "logs\hello-agent-err.log") -PassThru -NoNewWindow

$maxAttempts = 30
for ($i = 0; $i -lt $maxAttempts; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:3000" -TimeoutSec 1 -UseBasicParsing
        if ($response.StatusCode -eq 200) { break }
    } catch {}
}

Start-Process "http://localhost:3000"

Write-Host "Hello Agent is running (PID: $($proc.Id))"
Write-Host "Press Ctrl+C to stop..."

try {
    $proc.WaitForExit()
} catch {
    Stop-Process -Id $proc.Id -Force
}
