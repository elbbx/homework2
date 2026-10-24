$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
try {
    $candidates = @()
    $fromPath = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($fromPath) { $candidates += $fromPath.Source }
    $candidates += @(
        "$env:ProgramFiles\nodejs\node.exe",
        "$env:LOCALAPPDATA\Programs\nodejs\node.exe",
        "$env:NVM_SYMLINK\node.exe",
        "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
    )
    $nodePath = $null
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
        $version = & $candidate --version 2>$null
        $major = ($version -replace '^v', '').Split('.')[0]
        if ($LASTEXITCODE -eq 0 -and [int]$major -ge 22) { $nodePath = $candidate; break }
    }
    if (-not $nodePath) {
        throw 'Node.js 22 or newer was not found. Install Node.js LTS from https://nodejs.org/ and run this launcher again.'
    }
    Write-Host "Node.js: $nodePath"
    Write-Host 'Keep this window open while using the website. Press Ctrl+C to stop.'
    $env:OPEN_BROWSER = '1'
    & $nodePath --env-file-if-exists=.env server.mjs
    if ($LASTEXITCODE -ne 0) { throw "Server exited with code $LASTEXITCODE. Check the error above." }
} catch {
    Write-Host "Startup failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
