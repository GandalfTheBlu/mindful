# setup_llm.ps1
# Usage: .\setup_llm.ps1

# Self-elevate if not running as admin
if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Start-Process powershell -Verb RunAs -ArgumentList "-File `"$PSCommandPath`""
    exit
}

$configPath = Join-Path $PSScriptRoot "config.json"
if (-not (Test-Path $configPath)) {
    Write-Error "config.json not found at $configPath"
    exit 1
}

$config = Get-Content $configPath | ConvertFrom-Json
$port = $config.llm.port
$binaryPath = $config.llm.binary
$model = $config.llm.model
$contextSize = $config.llm.contextSize
$extraArgs = $config.llm.extraArgs

# Resolve model path relative to config if not absolute
if (-not [System.IO.Path]::IsPathRooted($model)) {
    $model = Join-Path $PSScriptRoot $model
}

if (-not (Test-Path $binaryPath)) {
    Write-Error "Binary not found: $binaryPath"
    exit 1
}

if (-not (Test-Path $model)) {
    Write-Error "Model not found: $model"
    exit 1
}

# Configure firewall rule
$ruleName = "llama-server port $port"
$existingRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existingRule) {
    Write-Host "Firewall rule '$ruleName' already exists, skipping."
} else {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow | Out-Null
    Write-Host "Firewall rule '$ruleName' created."
}

# Start llama-server
$serverArgs = "-m `"$model`" --port $port -c $contextSize --host 0.0.0.0 $extraArgs"
Write-Host "Starting llama-server..."
Write-Host "$binaryPath $serverArgs"
Start-Process -FilePath $binaryPath -ArgumentList $serverArgs
