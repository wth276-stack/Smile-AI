$tenantId = "cmmybiwq70000ums4qnsds8xe"
$contactId = "visitor_demo_" + (Get-Date -Format "HHmmss")
$contactName = "Demo Customer"

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host ""
Write-Host "====================================" -ForegroundColor Cyan
Write-Host "  AI Top Sales - Chat Tester" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host "  Contact: $contactName ($contactId)" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Type your message and press Enter."
Write-Host "Type 'exit' to quit."
Write-Host ""

while ($true) {
    $msg = Read-Host "You"
    if ($msg -eq "exit") { break }
    if ([string]::IsNullOrWhiteSpace($msg)) { continue }

    try {
        $body = @{
            tenantId = $tenantId
            channel = "WhatsApp"
            externalContactId = $contactId
            contactName = $contactName
            message = $msg
        } | ConvertTo-Json -Compress

        $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($body)

        $r = Invoke-RestMethod -Uri http://localhost:3001/api/chat/message -Method POST -ContentType "application/json; charset=utf-8" -Body $bodyBytes

        Write-Host ""
        Write-Host "AI: $($r.reply)" -ForegroundColor Green
        if ($r.sideEffects -and $r.sideEffects.Count -gt 0) {
            foreach ($e in $r.sideEffects) {
                Write-Host "[Side Effect] $($e.type): $($e.data | ConvertTo-Json -Compress)" -ForegroundColor Yellow
            }
        }
        Write-Host ""
    } catch {
        Write-Host "Error: $_" -ForegroundColor Red
    }
}

Write-Host "Bye!" -ForegroundColor Cyan
