# StreamFlex : installe le travailleur autonome (durées + images de jaquettes) en tâche planifiée Windows.
# Il démarre à chaque ouverture de session, sans fenêtre, et se relance en cas d'erreur.
#   Installer   : powershell -ExecutionPolicy Bypass -File setup_worker.ps1
#   Désinstaller: powershell -ExecutionPolicy Bypass -File setup_worker.ps1 -Remove
param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$TaskName = 'StreamFlex media worker'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Script = Join-Path $Here 'media_worker.py'

if ($Remove) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Tâche « $TaskName » supprimée."
  exit 0
}

# Python (pythonw : sans fenêtre)
$py = (& py -3 -c "import sys; print(sys.executable)") 2>$null
if (-not $py) { Write-Host 'Python 3 introuvable (commande py).' -ForegroundColor Red; exit 1 }
$pyw = Join-Path (Split-Path -Parent $py) 'pythonw.exe'
if (-not (Test-Path $pyw)) { $pyw = $py }

# ffmpeg / ffprobe
$ff = Get-Command ffmpeg -ErrorAction SilentlyContinue
$fp = Get-Command ffprobe -ErrorAction SilentlyContinue
if (-not $ff -or -not $fp) {
  Write-Host 'ffmpeg introuvable. Installe-le avec :' -ForegroundColor Yellow
  Write-Host '  winget install --id Gyan.FFmpeg -e'
  Write-Host 'puis ferme et rouvre PowerShell, et relance ce script.'
  exit 1
}

# Réglages
$envFile = Join-Path $Here 'worker.env'
if (-not (Test-Path $envFile)) {
  Write-Host "worker.env manquant dans $Here (SUPABASE_URL=... et WORKER_SECRET=...)." -ForegroundColor Red
  exit 1
}
# chemin de ffmpeg mémorisé : la tâche planifiée ne voit pas toujours le PATH mis à jour par winget
$ffDir = Split-Path -Parent $ff.Source
$lines = Get-Content $envFile | Where-Object { $_ -notmatch '^\s*FFMPEG_DIR=' }
$lines + "FFMPEG_DIR=$ffDir" | Set-Content -Path $envFile -Encoding utf8

$action = New-ScheduledTaskAction -Execute $pyw -Argument "`"$Script`"" -WorkingDirectory $Here
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 5) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Host "Installé : « $TaskName » tourne maintenant et démarrera à chaque ouverture de session." -ForegroundColor Green
Write-Host "Journal : $(Join-Path $Here 'worker.log')"
