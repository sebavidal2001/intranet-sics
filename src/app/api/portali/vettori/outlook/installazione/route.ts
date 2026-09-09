import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { requireVettori } from "@/lib/portali/vettori/api-guard";
import { VETTORI_RUOLI } from "@/lib/portali/vettori/ruoli";

export async function GET(request: NextRequest) {
  const guard = await requireVettori({ ruoli: [VETTORI_RUOLI.amministrazione] });
  if (!guard.ok) return guard.response;
  const origine = new URL(process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin).origin;
  const helper = (await readFile(path.join(process.cwd(), "scripts/vettori/outlook/Apri-Bozza.ps1"))).toString("base64");
  const config = Buffer.from(JSON.stringify({ origine })).toString("base64");
  const script = `# Collegamento SICS Outlook, solo bozze. Eseguire con Windows PowerShell.
$ErrorActionPreference = 'Stop'
if (-not [type]::GetTypeFromProgID('Outlook.Application')) { throw 'Installare Outlook classico: Outlook COM non disponibile su questo PC.' }
$destinazione = Join-Path $env:LOCALAPPDATA 'SICS-Outlook'
New-Item -ItemType Directory -Path $destinazione -Force | Out-Null
$helperPath = Join-Path $destinazione 'Apri-Bozza.ps1'
[IO.File]::WriteAllBytes($helperPath, [Convert]::FromBase64String('${helper}'))
[IO.File]::WriteAllBytes((Join-Path $destinazione 'config.json'), [Convert]::FromBase64String('${config}'))
$registro = 'HKCU:\\Software\\Classes\\sics-outlook'
New-Item -Path $registro -Force | Out-Null
Set-Item -Path $registro -Value 'URL:SICS Outlook'
New-ItemProperty -Path $registro -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
New-Item -Path ($registro + '\\shell\\open\\command') -Force | Out-Null
$powershellPath = Join-Path $env:WINDIR 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'
$comando = '"' + $powershellPath + '" -NoProfile -STA -WindowStyle Hidden -File "' + $helperPath + '" -Uri "%1"'
Set-Item -Path ($registro + '\\shell\\open\\command') -Value $comando
Write-Host 'Collegamento Outlook installato. Dal portale, usare Apri in Outlook.'
`;
  return new NextResponse(script, { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": 'attachment; filename="Installa-SICS-Outlook.ps1"', "Cache-Control": "no-store" } });
}
