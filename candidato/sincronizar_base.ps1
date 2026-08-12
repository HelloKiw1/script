param(
    [string]$ZipPath = (Join-Path $PSScriptRoot 'dados\consulta_cand_2026.zip')
)

$ErrorActionPreference = 'Stop'
$zip = Get-Item -LiteralPath $ZipPath

if ($zip.Extension -ne '.zip') {
    throw "O arquivo precisa ter extensão .zip: $($zip.FullName)"
}

$yearMatch = [regex]::Match($zip.Name, 'consulta_cand_(\d{4})\.zip$', 'IgnoreCase')
if (-not $yearMatch.Success) {
    throw 'Use o nome consulta_cand_AAAA.zip para identificar o ano da base.'
}

$year = $yearMatch.Groups[1].Value
$bytes = [System.IO.File]::ReadAllBytes($zip.FullName)
$base64 = [Convert]::ToBase64String($bytes)
$hash = (Get-FileHash -LiteralPath $zip.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
$generatedAt = (Get-Date).ToString('o')
$target = Join-Path $zip.DirectoryName "consulta_cand_$year.js"
$javascript = @"
globalThis.CANDIDATRON_BUNDLED_ZIPS = globalThis.CANDIDATRON_BUNDLED_ZIPS || {};
globalThis.CANDIDATRON_BUNDLED_ZIPS['$year'] = {
  filename: '$($zip.Name)',
  size: $($bytes.Length),
  sha256: '$hash',
  generatedAt: '$generatedAt',
  base64: '$base64'
};
"@

[System.IO.File]::WriteAllText($target, $javascript, [System.Text.UTF8Encoding]::new($false))
Write-Host "Base $year sincronizada: $target" -ForegroundColor Green
Write-Host "ZIP: $($bytes.Length) bytes | SHA-256: $hash" -ForegroundColor DarkGray
