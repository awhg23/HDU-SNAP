$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RootDir

$VenvPython = Join-Path $RootDir ".venv\Scripts\python.exe"
$ModelDir = Join-Path $RootDir ".models\moka-ai_m3e-base"

if (-not (Test-Path $VenvPython)) {
    Write-Host "[HDU-SNAP] Creating virtual environment..."
    py -m venv .venv
}

Write-Host "[HDU-SNAP] Installing full dependencies..."
& $VenvPython -m pip install -U pip
& $VenvPython -m pip install -r requirements.txt

if (-not (Test-Path $ModelDir)) {
    Write-Host "[HDU-SNAP] Installing local vector model..."
    & $VenvPython -c "from sentence_transformers import SentenceTransformer; model = SentenceTransformer('moka-ai/m3e-base'); model.save(r'.models\moka-ai_m3e-base'); print('Saved model to .models\\moka-ai_m3e-base')"
} else {
    Write-Host "[HDU-SNAP] Local vector model already exists: $ModelDir"
}

Write-Host ""
Write-Host "[HDU-SNAP] Full 3-tier environment is ready."
Write-Host ""
Write-Host "Next step:"
Write-Host "  .\.venv\Scripts\python.exe main.py"
