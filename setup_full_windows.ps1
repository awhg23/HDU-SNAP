$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $RootDir "scripts\setup_full_windows.ps1") @args
exit $LASTEXITCODE
