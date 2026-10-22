Set-Location -LiteralPath $PSScriptRoot
$env:OPEN_BROWSER = '1'
node --env-file-if-exists=.env server.mjs
