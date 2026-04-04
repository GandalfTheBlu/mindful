# restart-server.ps1
# Kills any process on port 3000 and starts the chat server fresh.

$port = 3000

$connections = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
foreach ($conn in $connections) {
    Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Milliseconds 300

$serverPath = Join-Path $PSScriptRoot "src\server\chatServer.js"
Start-Process -FilePath "node" -ArgumentList $serverPath -WorkingDirectory $PSScriptRoot -WindowStyle Minimized

Write-Host "Server restarted on port $port"
