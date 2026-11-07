# Midas Pi alarm (candidate D4): run every 5 minutes by the Windows task "Midas Pi alarm".
# Notifies once when the Pi goes down / reports an error / stops updating in market hours, and once when it recovers.
$state = Join-Path $env:LOCALAPPDATA 'midas-pi-alarm.txt'
$problem = ''
try {
  $s = Invoke-RestMethod -Uri 'http://192.168.2.51:3000/api/status' -TimeoutSec 15
  if (-not $s.ok -and $s.uptimeMin -gt 10) { $problem = "Midas reports an error: $($s.lastError)" }
  elseif ($s.marketOpen -and $s.lastRun -and ((Get-Date).ToUniversalTime() - [datetime]$s.lastRun).TotalMinutes -gt 20) {
    $problem = "Midas has not run for $([int]((Get-Date).ToUniversalTime() - [datetime]$s.lastRun).TotalMinutes) min"
  }
} catch { $problem = 'Midas Pi unreachable (Wi-Fi, power or app down)' }

$last = if (Test-Path $state) { Get-Content $state -Raw } else { '' }
$last = "$last".Trim()
if ($problem -eq $last) { exit 0 }
Set-Content -Path $state -Value $problem -Encoding utf8
$text = if ($problem) { $problem } else { 'Midas Pi is back to normal' }

[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml("<toast><visual><binding template='ToastGeneric'><text>Midas</text><text>$([Security.SecurityElement]::Escape($text))</text></binding></visual></toast>")
$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($xml))
