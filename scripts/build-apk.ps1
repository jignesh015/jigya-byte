param([string]$SdkPath = $env:ANDROID_HOME, [string]$JdkPath = $env:JAVA_HOME,
  [string]$Architectures = 'arm64-v8a', [switch]$SkipPrebuild)
$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectPath
$unityAndroid = 'C:\Program Files\Unity\Hub\Editor\6000.3.8f1\Editor\Data\PlaybackEngines\AndroidPlayer'
if (-not $SdkPath) { $SdkPath = Join-Path $unityAndroid 'SDK' }
if (-not $JdkPath) { $JdkPath = Join-Path $unityAndroid 'OpenJDK' }
if (-not (Test-Path -LiteralPath (Join-Path $SdkPath 'platform-tools\adb.exe'))) { throw 'Set ANDROID_HOME or pass -SdkPath to your Android SDK.' }
if (-not (Test-Path -LiteralPath (Join-Path $JdkPath 'bin\java.exe'))) { throw 'Set JAVA_HOME or pass -JdkPath to JDK 17 or newer.' }
$env:ANDROID_HOME = $SdkPath
$env:JAVA_HOME = $JdkPath
$env:PATH = "$JdkPath\bin;$env:PATH"
$env:CI = '1'
$env:NODE_ENV = 'production'
if (-not $SkipPrebuild) {
  & npx.cmd expo prebuild --platform android --no-install
  if ($LASTEXITCODE -ne 0) { throw 'Expo prebuild failed.' }
}
$sdkProperty = $SdkPath.Replace('\', '/').Replace(':', '\:')
Set-Content -LiteralPath (Join-Path $projectPath 'android\local.properties') -Value "sdk.dir=$sdkProperty"
Push-Location (Join-Path $projectPath 'android')
try {
  & .\gradlew.bat app:assembleRelease "-PreactNativeArchitectures=$Architectures" --console=plain
  if ($LASTEXITCODE -ne 0) { throw 'Android APK build failed.' }
} finally { Pop-Location }
$artifactPath = Join-Path $projectPath 'artifacts'
New-Item -ItemType Directory -Path $artifactPath -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectPath 'android\app\build\outputs\apk\release\app-release.apk') -Destination (Join-Path $artifactPath 'JigyaByte.apk')
$apkFile = Join-Path $artifactPath 'JigyaByte.apk'
$hasher = [System.Security.Cryptography.SHA256]::Create()
try { Write-Output ([System.BitConverter]::ToString($hasher.ComputeHash([System.IO.File]::ReadAllBytes($apkFile))).Replace('-', '').ToLowerInvariant()) }
finally { $hasher.Dispose() }
Write-Output 'Personal testing APK built with the generated development signing key. Preserve android/app/debug.keystore for future in-place updates.'
