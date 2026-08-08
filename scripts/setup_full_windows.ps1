$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $RootDir

$VenvDir = Join-Path $RootDir ".venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
$ModelDir = Join-Path $RootDir ".models\moka-ai_m3e-base"

function Test-SupportedPython([string]$PythonPath) {
    if (-not $PythonPath -or -not (Test-Path -LiteralPath $PythonPath -PathType Leaf)) {
        return $false
    }
    & $PythonPath -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" 2>$null
    return $LASTEXITCODE -eq 0
}

function Get-PythonVersion([string]$PythonPath) {
    if (-not $PythonPath -or -not (Test-Path -LiteralPath $PythonPath -PathType Leaf)) {
        return "unknown"
    }
    $VersionOutput = & $PythonPath -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')" 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $VersionOutput) {
        return "unknown"
    }
    return [string]$VersionOutput
}

function Find-SupportedPython {
    $Launcher = Get-Command py -ErrorAction SilentlyContinue
    if ($Launcher) {
        foreach ($RequestedVersion in @("3.12", "3.11", "3.10")) {
            $Candidate = & py "-$RequestedVersion" -c "import sys; print(sys.executable)" 2>$null
            if ($LASTEXITCODE -eq 0 -and (Test-SupportedPython ([string]$Candidate))) {
                return [string]$Candidate
            }
        }
    }
    foreach ($CommandName in @("python3.12", "python3.11", "python3.10", "python3", "python")) {
        $Command = Get-Command $CommandName -ErrorAction SilentlyContinue
        if ($Command -and (Test-SupportedPython $Command.Source)) {
            return $Command.Source
        }
    }
    return $null
}

if (-not (Test-SupportedPython $VenvPython)) {
    $BasePython = Find-SupportedPython
    if (-not $BasePython) {
        throw "Python 3.10 or newer is required. Install it from python.org, then rerun setup_full_windows.ps1."
    }

    if (Test-Path -LiteralPath $VenvDir) {
        $VenvItem = Get-Item -LiteralPath $VenvDir -Force
        if (-not $VenvItem.PSIsContainer) {
            throw "Refusing to replace non-directory path: $VenvDir"
        }
        if (($VenvItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Refusing to replace linked virtual environment: $VenvDir"
        }
        $OldVersion = Get-PythonVersion $VenvPython
        $SafeVersion = $OldVersion -replace '[^0-9.]', ''
        if (-not $SafeVersion) { $SafeVersion = "unknown" }
        $Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
        $BackupDir = Join-Path $RootDir ".venv-python$SafeVersion-backup-$Timestamp"
        if (Test-Path -LiteralPath $BackupDir) {
            throw "Backup target already exists: $BackupDir"
        }
        Write-Host "[HDU-SNAP] Existing .venv uses Python $OldVersion; moving it to:"
        Write-Host "  $BackupDir"
        Move-Item -LiteralPath $VenvDir -Destination $BackupDir -ErrorAction Stop
    }

    Write-Host "[HDU-SNAP] Creating .venv with $BasePython ($(Get-PythonVersion $BasePython))..."
    & $BasePython -m venv $VenvDir
    if ($LASTEXITCODE -ne 0 -or -not (Test-SupportedPython $VenvPython)) {
        throw "Failed to create a Python 3.10+ virtual environment."
    }
}

Write-Host "[HDU-SNAP] Installing full dependencies..."
& $VenvPython -m pip install -U pip
& $VenvPython -m pip install -r (Join-Path $RootDir "requirements.txt")

if (-not (Test-Path $ModelDir)) {
    Write-Host "[HDU-SNAP] Installing local vector model..."
    & $VenvPython -c "from sentence_transformers import SentenceTransformer; model = SentenceTransformer('moka-ai/m3e-base'); model.save(r'$ModelDir'); print('Saved model')"
} else {
    Write-Host "[HDU-SNAP] Local vector model already exists: $ModelDir"
}

Write-Host ""
Write-Host "[HDU-SNAP] Full 3-tier environment is ready."
Write-Host ""
Write-Host "Next step:"
Write-Host "  .\.venv\Scripts\python.exe main.py"
