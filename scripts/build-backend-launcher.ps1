$ErrorActionPreference = 'Stop'
$projectPath = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$nodePath = (Get-Command node -CommandType Application | Select-Object -First 1).Source
$nodeVersion = & $nodePath --version
if ([version]$nodeVersion.TrimStart('v') -lt [version]'24.13.0') {
    throw 'The backend requires Node.js 24.13 or newer.'
}
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) {
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path -LiteralPath $compiler)) { throw 'The Windows .NET Framework C# compiler is missing.' }
$outputPath = Join-Path $projectPath 'artifacts\backend-launcher'
New-Item -ItemType Directory -Force -Path $outputPath | Out-Null
# Verbatim C# literals preserve Windows paths, including spaces and backslashes.
$escapedProject = $projectPath.Replace('"', '""')
$escapedNode = $nodePath.Replace('"', '""')
$pathsFile = Join-Path $outputPath 'LauncherPaths.cs'
@"
internal static class LauncherPaths {
    internal const string Project = @"$escapedProject";
    internal const string Node = @"$escapedNode";
}
"@ | Set-Content -LiteralPath $pathsFile -Encoding UTF8
$executable = Join-Path $outputPath 'JigyaByte Backend.exe'
& $compiler /nologo /target:exe /optimize+ "/out:$executable" (Join-Path $PSScriptRoot 'BackendLauncher.cs') $pathsFile
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed.' }
Write-Output "Created: $executable"
Write-Output 'Copy the EXE to your desktop and double-click it. Keep the project in its current location.'
