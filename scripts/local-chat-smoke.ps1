#Requires -Version 5.1
<#
.SYNOPSIS
  Register a tenant, seed one knowledge doc, POST /api/chat/message — for local OpenAI smoke test.
  Watch the API terminal for [LLM-PIPELINE] runAiEngine source=llm_pipeline

  Prerequisites: pnpm dev:api running, Postgres up, root .env with DATABASE_URL + OPENAI_API_KEY

.PARAMETER BaseUrl
  API base URL (default http://localhost:3001)
#>
param(
  [string]$BaseUrl = "http://localhost:3001"
)

$ErrorActionPreference = "Stop"

function Get-JwtPayloadObject {
  param([string]$Jwt)
  $parts = $Jwt.Split(".")
  if ($parts.Count -lt 2) { throw "Invalid JWT" }
  $payload = $parts[1]
  switch ($payload.Length % 4) {
    2 { $payload += "==" }
    3 { $payload += "=" }
  }
  $payload = $payload.Replace("-", "+").Replace("_", "/")
  $bytes = [Convert]::FromBase64String($payload)
  $json = [System.Text.Encoding]::UTF8.GetString($bytes)
  return $json | ConvertFrom-Json
}

$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$email = "smoke-$stamp@example.com"
$password = "SmokeTest1!"

Write-Host "==> POST $BaseUrl/api/auth/register"
$regBody = @{
  tenantName = "Smoke Tenant $stamp"
  name       = "Smoke User"
  email      = $email
  password   = $password
} | ConvertTo-Json

$reg = Invoke-RestMethod -Uri "$BaseUrl/api/auth/register" -Method Post -ContentType "application/json" -Body $regBody
$payload = Get-JwtPayloadObject -Jwt $reg.accessToken
$tenantId = $payload.tenantId
if (-not $tenantId) { throw "No tenantId in JWT payload" }
Write-Host "    tenantId = $tenantId"

$headers = @{ Authorization = "Bearer $($reg.accessToken)" }

# ASCII-only in script file avoids PowerShell 5.1 default encoding issues on Windows
$kbBody = @{
  title   = "HIFU tightening"
  content = "HIFU tightening`nEffect: lift`nPrice: HKD 1200`nDuration: ~60 min"
} | ConvertTo-Json

Write-Host "==> POST /api/knowledge-base (seed)"
Invoke-RestMethod -Uri "$BaseUrl/api/knowledge-base" -Method Post -Headers $headers -ContentType "application/json" -Body $kbBody | Out-Null

$chatBody = @{
  tenantId           = $tenantId
  channel            = "WEBCHAT"
  externalContactId  = "smoke-$stamp"
  contactName        = "Ming"
  message            = "How much is HIFU?"
} | ConvertTo-Json

Write-Host "==> POST /api/chat/message"
$chat = Invoke-RestMethod -Uri "$BaseUrl/api/chat/message" -Method Post -ContentType "application/json" -Body $chatBody

Write-Host ""
Write-Host "Reply:" $chat.reply
Write-Host ""
Write-Host "Next: check API terminal for:"
Write-Host "  [LLM-PIPELINE] runAiEngine source=llm_pipeline   (OpenAI planner ran)"
Write-Host "  [LLM-PIPELINE] runAiEngine source=rule_fallback  (rule engine only this turn)"
