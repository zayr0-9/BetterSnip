$ErrorActionPreference = 'Stop'
$recorderProj = Join-Path $PSScriptRoot '..\native\win-recorder\win-recorder.vcxproj'
$clipboardProj = Join-Path $PSScriptRoot '..\native\clipboard-file\clipboard-file.vcxproj'
$outDir = Join-Path $PSScriptRoot '..\dist\native'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$cmd = Get-Command msbuild.exe -ErrorAction SilentlyContinue
$msbuild = if ($cmd) { $cmd.Source } else { $null }
if (-not $msbuild) {
  $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
  if (Test-Path $vswhere) {
    $install = & $vswhere -latest -products * -requires Microsoft.Component.MSBuild -property installationPath
    if ($install) { $msbuild = Join-Path $install 'MSBuild\Current\Bin\MSBuild.exe' }
  }
}
if (-not $msbuild -or -not (Test-Path $msbuild)) { throw 'MSBuild not found. Install Visual Studio Build Tools with Desktop development with C++.' }
& $msbuild $recorderProj /p:Configuration=Release /p:Platform=x64 /m
& $msbuild $clipboardProj /p:Configuration=Release /p:Platform=x64 /m

$builtRecorder = Get-ChildItem (Join-Path $PSScriptRoot '..\native\win-recorder') -Recurse -Filter win-recorder.exe | Where-Object FullName -match 'Release' | Select-Object -First 1
if (-not $builtRecorder) { throw 'Native recorder exe was not produced.' }
$builtClipboard = Get-ChildItem (Join-Path $PSScriptRoot '..\native\clipboard-file') -Recurse -Filter clipboard-file.exe | Where-Object FullName -match 'Release' | Select-Object -First 1
if (-not $builtClipboard) { throw 'Native clipboard exe was not produced.' }

New-Item -ItemType Directory -Force -Path $outDir | Out-Null
Copy-Item $builtRecorder.FullName (Join-Path $outDir 'win-recorder.exe') -Force
Copy-Item $builtClipboard.FullName (Join-Path $outDir 'clipboard-file.exe') -Force
Write-Host "Copied $($builtRecorder.FullName) to $outDir"
Write-Host "Copied $($builtClipboard.FullName) to $outDir"
