# Regenerates src/lib/logoData.ts from the frontend wordmark.
# Run from the rabbit365-API directory: powershell -File scripts/embed-logo.ps1
$ErrorActionPreference = "Stop"

$png = Join-Path $PSScriptRoot "..\..\rabbit-365\public\rabbit_365_logo.png"
$out = Join-Path $PSScriptRoot "..\src\lib\logoData.ts"

if (-not (Test-Path -LiteralPath $png)) {
  throw "Logo not found at $png"
}

$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($png))
$content = @"
// Auto-generated from rabbit-365/public/rabbit_365_logo.png — do not edit by hand.
// Regenerate with: scripts/embed-logo.ps1
export const LOGO_PNG_BASE64 =
  "$b64";

export const LOGO_PNG_BYTES = (() => {
  const binary = atob(LOGO_PNG_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
})();
"@

[IO.File]::WriteAllText($out, $content, (New-Object Text.UTF8Encoding($false)))
Write-Output "Wrote $out ($((Get-Item -LiteralPath $out).Length) bytes) from $png"
