$ErrorActionPreference = "Stop"
$port = 4173
$baseUrl = "http://127.0.0.1:$port"
$configPath = Join-Path (Resolve-Path ".") "local.config.json"
$configHashBefore = if (Test-Path -LiteralPath $configPath) {
  (Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash
} else {
  "<missing>"
}
$previousPort = $env:PORT
$env:PORT = [string]$port

$process = Start-Process `
  -FilePath "node" `
  -ArgumentList @("--disable-warning=ExperimentalWarning", "--experimental-strip-types", "server/index.ts") `
  -WorkingDirectory (Resolve-Path ".") `
  -WindowStyle Hidden `
  -PassThru

try {
  $lastError = ""
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 400
    try {
      $response = Invoke-WebRequest -Uri "$baseUrl/api/config" -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200) {
        $ready = $true
        break
      }
    } catch {
      $lastError = $_.Exception.Message
    }
  }

  if (-not $ready) {
    throw "Server did not become ready: $lastError"
  }

  $configResponse = Invoke-RestMethod -Uri "$baseUrl/api/config" -Method Get -TimeoutSec 2
  if ($configResponse.config.apiKeySet) {
    if ($configResponse.config.apiKey -ne "********") {
      throw "Configured API Key was not masked."
    }
  } elseif ($configResponse.config.apiKey -ne "") {
    throw "Invalid or missing API Key was returned to the client."
  }

  $invalidBody = '{"apiKey":"\u4e1a\u52a1\u7406\u89e3\u2014\u2014\u672c\u9879\u76ee\u627f\u8f7d\u4e00\u9875\u7ed3\u6784\u5316\u6b63\u6587"}'
  $invalidStatus = 0
  $invalidMessage = ""
  try {
    Invoke-WebRequest `
      -Uri "$baseUrl/api/config" `
      -Method Put `
      -ContentType "application/json" `
      -Body $invalidBody `
      -UseBasicParsing `
      -TimeoutSec 2 | Out-Null
  } catch {
    if ($_.Exception.Response) {
      $invalidStatus = [int]$_.Exception.Response.StatusCode
    }
    $invalidMessage = $_.ErrorDetails.Message
  }
  if ($invalidStatus -ne 400 -or $invalidMessage -notmatch "API Key") {
    throw "Invalid API Key was not rejected with HTTP 400 and a clear error."
  }

  $configHashAfter = if (Test-Path -LiteralPath $configPath) {
    (Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash
  } else {
    "<missing>"
  }
  if ($configHashAfter -ne $configHashBefore) {
    throw "Rejected API Key changed local.config.json."
  }

  $multiTitleBody = '{"text":"\u9875\u6807\u9898\uff1aA\nA\n\u9875\u6807\u9898\uff1aB\nB\n\u9875\u6807\u9898\uff1aC\nC\n\u9875\u6807\u9898\uff1aD\nD\n---\n\u9875\u6807\u9898\uff1aE\nE\n# F\nF"}'
  $parseResponse = Invoke-RestMethod `
    -Uri "$baseUrl/api/pages/parse" `
    -Method Post `
    -ContentType "application/json" `
    -Body $multiTitleBody `
    -TimeoutSec 2
  if ($parseResponse.pageCount -ne 2 -or $parseResponse.pageTitleIssues.Count -ne 2) {
    throw "Page-title conflicts were not reported by the parse API."
  }

  $splitBody = $multiTitleBody.Substring(0, $multiTitleBody.Length - 1) + ',"splitByTitleMarkers":true}'
  $splitResponse = Invoke-RestMethod `
    -Uri "$baseUrl/api/pages/parse" `
    -Method Post `
    -ContentType "application/json" `
    -Body $splitBody `
    -TimeoutSec 2
  if ($splitResponse.pageCount -ne 6 -or $splitResponse.pageTitleIssues.Count -ne 0) {
    throw "One-click title-marker splitting did not produce six clean pages."
  }

  $generateConflictBody = '{"pages":[{"content":"\u9875\u6807\u9898\uff1aA\nA\n\u9875\u6807\u9898\uff1aB\nB"}]}'
  $generateConflictStatus = 0
  $generateConflictMessage = ""
  try {
    Invoke-WebRequest `
      -Uri "$baseUrl/api/deck/generate" `
      -Method Post `
      -ContentType "application/json" `
      -Body $generateConflictBody `
      -UseBasicParsing `
      -TimeoutSec 2 | Out-Null
  } catch {
    if ($_.Exception.Response) {
      $generateConflictStatus = [int]$_.Exception.Response.StatusCode
    }
    $generateConflictMessage = $_.ErrorDetails.Message
  }
  if ($generateConflictStatus -ne 400 -or $generateConflictMessage -notmatch "2") {
    throw "Server-side generation preflight did not block a multi-title page."
  }

  Write-Output "SERVER_OK"
  Write-Output "INVALID_API_KEY_REJECTED"
  Write-Output "CONFIG_UNCHANGED"
  Write-Output "PAGE_SPLIT_API_OK"
  Write-Output "GENERATION_PREFLIGHT_OK"
} finally {
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force
  }
  $env:PORT = $previousPort
}
