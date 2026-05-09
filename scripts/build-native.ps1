$ErrorActionPreference = 'Stop'
$proj = Join-Path $PSScriptRoot '..\native\win-recorder\win-recorder.vcxproj'
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
& $msbuild $proj /p:Configuration=Release /p:Platform=x64 /m
$built = Get-ChildItem (Join-Path $PSScriptRoot '..\native\win-recorder') -Recurse -Filter win-recorder.exe | Where-Object FullName -match 'Release' | Select-Object -First 1
if (-not $built) { throw 'Native recorder exe was not produced.' }
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
Copy-Item $built.FullName (Join-Path $outDir 'win-recorder.exe') -Force
Write-Host "Copied $($built.FullName) to $outDir"
