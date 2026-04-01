# Kill whatever is LISTENING on a TCP port (Windows). Usage: .\scripts\kill-port.ps1 3000
param(
  [Parameter(Mandatory = $true)]
  [int]$Port
)

$conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $conns) {
  Write-Host "No process is listening on port $Port."
  exit 0
}

$procIds = $conns.OwningProcess | Sort-Object -Unique
foreach ($procId in $procIds) {
  try {
    $p = Get-Process -Id $procId -ErrorAction Stop
    Write-Host "Stopping PID $procId ($($p.ProcessName)) on port $Port"
    Stop-Process -Id $procId -Force
  } catch {
    Write-Host "Could not stop PID $procId : $_"
  }
}
