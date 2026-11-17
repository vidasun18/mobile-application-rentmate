param(
    [string]$RuntimeArchive,
    [string]$RuntimeSha256,
    [switch]$PrepareOnly,
    [switch]$Offline
)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskProject = Join-Path $taskRoot 'server-android'
$taskRuntimeVersion = '24.22.0-0'
$taskRuntimeFile = "nodejs-mobile-android-$taskRuntimeVersion.zip"
$taskLocalProperties = Join-Path $taskProject 'local.properties'
if (-not (Test-Path -LiteralPath $taskLocalProperties)) {
    $taskSdk = $env:ANDROID_HOME
    if (-not $taskSdk) { $taskSdk = $env:ANDROID_SDK_ROOT }
    if (-not $taskSdk) { $taskSdk = Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
    if (-not (Test-Path -LiteralPath (Join-Path $taskSdk 'platforms/android-36/android.jar'))) { throw 'Configure Android SDK 36 using ANDROID_HOME or server-android/local.properties.' }
    Set-Content -LiteralPath $taskLocalProperties -Value ('sdk.dir=' + $taskSdk.Replace('\','/'))
}
$taskDownloadDirectory = Join-Path $taskRoot '.local/android-runtime'
New-Item -ItemType Directory -Path $taskDownloadDirectory -Force | Out-Null

if (-not $RuntimeArchive) {
    if ($Offline) { throw 'Supply -RuntimeArchive and -RuntimeSha256 for an offline build.' }
    $taskReleaseUri = "https://api.github.com/repos/fogtape/nodejs-mobile/releases/tags/v$taskRuntimeVersion"
    $taskRelease = Invoke-RestMethod -Uri $taskReleaseUri -Headers @{ 'User-Agent' = 'RentMate-local-server-build' }
    $taskAsset = $taskRelease.assets | Where-Object name -eq $taskRuntimeFile
    if (-not $taskAsset) { throw 'The pinned Android full runtime asset is unavailable.' }
    $RuntimeArchive = Join-Path $taskDownloadDirectory $taskRuntimeFile
    if (-not (Test-Path -LiteralPath $RuntimeArchive)) { Invoke-WebRequest -Uri $taskAsset.browser_download_url -OutFile $RuntimeArchive }
    if ($taskAsset.digest -match '^sha256:([0-9a-fA-F]{64})$') { $RuntimeSha256 = $Matches[1] }
    else {
        $taskSumsAsset = $taskRelease.assets | Where-Object name -eq 'SHA256SUMS'
        if (-not $taskSumsAsset) { throw 'The runtime release has no checksum. Refusing to package an unverified binary.' }
        $taskSums = (Invoke-WebRequest -Uri $taskSumsAsset.browser_download_url).Content
        $taskLine = $taskSums -split "`n" | Where-Object { $_.TrimEnd().EndsWith($taskRuntimeFile) }
        if ($taskLine -notmatch '^([0-9a-fA-F]{64})\s') { throw 'The runtime checksum entry was not found.' }
        $RuntimeSha256 = $Matches[1]
    }
}
if ($RuntimeSha256 -notmatch '^[0-9a-fA-F]{64}$') { throw 'Supply the SHA-256 from the pinned runtime release.' }
$RuntimeArchive = (Resolve-Path -LiteralPath $RuntimeArchive).Path
$taskActual = (Get-FileHash -LiteralPath $RuntimeArchive -Algorithm SHA256).Hash
if ($taskActual -ne $RuntimeSha256) { throw 'Runtime archive checksum mismatch. Nothing was installed.' }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskNodeRoot = Join-Path $taskProject 'app/libnode'
New-Item -ItemType Directory -Path $taskNodeRoot -Force | Out-Null
$taskNodePrefix = [IO.Path]::GetFullPath($taskNodeRoot) + [IO.Path]::DirectorySeparatorChar
$taskArchive = [IO.Compression.ZipFile]::OpenRead($RuntimeArchive)
try {
    foreach ($taskEntry in $taskArchive.Entries) {
        $taskRelative = $null
        if ($taskEntry.FullName -match '(?:^|/)(include/node/.+)$') { $taskRelative = $Matches[1] }
        elseif ($taskEntry.FullName -match '(?:^|/)(bin/(?:arm64-v8a|armeabi-v7a|x86_64)/libnode\.so)$') { $taskRelative = $Matches[1] }
        if (-not $taskRelative -or $taskEntry.FullName.EndsWith('/')) { continue }
        $taskTarget = [IO.Path]::GetFullPath((Join-Path $taskNodeRoot $taskRelative))
        if (-not $taskTarget.StartsWith($taskNodePrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe SDK archive path.' }
        New-Item -ItemType Directory -Path (Split-Path -Parent $taskTarget) -Force | Out-Null
        [IO.Compression.ZipFileExtensions]::ExtractToFile($taskEntry, $taskTarget, $true)
    }
} finally { $taskArchive.Dispose() }
foreach ($taskAbi in @('arm64-v8a','armeabi-v7a','x86_64')) {
    if (-not (Test-Path -LiteralPath (Join-Path $taskNodeRoot "bin/$taskAbi/libnode.so"))) { throw "Missing Android library: $taskAbi" }
}
if (-not (Test-Path -LiteralPath (Join-Path $taskNodeRoot 'include/node/node.h'))) { throw 'Missing Node embedding headers.' }
$taskNodeVersion = Get-Content -LiteralPath (Join-Path $taskNodeRoot 'include/node/node_version.h') -Raw
if ($taskNodeVersion -notmatch '#define\s+NODE_MAJOR_VERSION\s+24\b' -or $taskNodeVersion -notmatch '#define\s+NODE_MINOR_VERSION\s+22\b') { throw 'The SDK headers do not match the pinned Node 24.22 runtime.' }

$taskPrepared = & node (Join-Path $taskRoot 'backend/scripts/prepare-phone-runtime.js') | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Server source preparation failed.' }
$taskAssets = Join-Path $taskProject 'app/src/main/assets'
New-Item -ItemType Directory -Path $taskAssets -Force | Out-Null
# Include Node's complete license and dependency notices with the runtime.
$taskLicense = Join-Path $taskDownloadDirectory 'Node-LICENSE'
$taskLicenseUri = "https://raw.githubusercontent.com/fogtape/nodejs-mobile/v$taskRuntimeVersion/LICENSE"
if (-not (Test-Path -LiteralPath $taskLicense)) {
    if ($Offline) { throw 'Offline build also requires .local/android-runtime/Node-LICENSE from the exact runtime source tag.' }
    # Release tags contain the patched Node source; upstream-base.txt exists only
    # on the separate recipe branch and is not part of the release source tree.
    $taskLicenseDownload = Join-Path $taskDownloadDirectory 'Node-LICENSE.download'
    Invoke-WebRequest -Uri $taskLicenseUri -OutFile $taskLicenseDownload -TimeoutSec 60
    if ((Get-Item -LiteralPath $taskLicenseDownload).Length -lt 10000 -or (Get-Content -LiteralPath $taskLicenseDownload -TotalCount 1) -ne 'Node.js is licensed for use as follows:') { throw 'The runtime license response is incomplete or invalid.' }
    Move-Item -LiteralPath $taskLicenseDownload -Destination $taskLicense
}
if ((Get-Item -LiteralPath $taskLicense).Length -lt 10000 -or (Get-Content -LiteralPath $taskLicense -TotalCount 1) -ne 'Node.js is licensed for use as follows:') { throw 'The cached runtime license is incomplete or invalid.' }
New-Item -ItemType Directory -Path (Join-Path $taskPrepared.directory 'licenses') -Force | Out-Null
Copy-Item -LiteralPath $taskLicense -Destination (Join-Path $taskPrepared.directory 'licenses/Node-LICENSE')
$taskZip = Join-Path $taskAssets 'runtime.zip'
# Replace only this generated archive, never database or user configuration files.
if (Test-Path -LiteralPath $taskZip) { Remove-Item -LiteralPath $taskZip }
[IO.Compression.ZipFile]::CreateFromDirectory($taskPrepared.directory, $taskZip, [IO.Compression.CompressionLevel]::Optimal, $false)
@{
    runtime_version=$taskRuntimeVersion; runtime_source='fogtape/nodejs-mobile'; runtime_preview=$true
    sdk_sha256=$taskActual; payload_sha256=(Get-FileHash -LiteralPath $taskZip -Algorithm SHA256).Hash
    license_source=$taskLicenseUri; license_sha256=(Get-FileHash -LiteralPath $taskLicense -Algorithm SHA256).Hash
    packages=$taskPrepared.packages; entry_sha256=$taskPrepared.entry_sha256
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskAssets 'runtime-manifest.json')
if ($PrepareOnly) { Write-Output 'Runtime verified and server payload prepared.'; exit 0 }

Push-Location $taskProject
try {
    $taskGradleArguments = @('--no-daemon', ':app:testDebugUnitTest', ':app:assembleDebug')
    if ($Offline) { $taskGradleArguments += '--offline' }
    & .\gradlew.bat @taskGradleArguments
    if ($LASTEXITCODE -ne 0) { throw 'Android server build failed.' }
} finally { Pop-Location }
$taskDeliverables = Join-Path $taskRoot 'deliverables'
New-Item -ItemType Directory -Path $taskDeliverables -Force | Out-Null
$taskApk = Join-Path $taskDeliverables 'RentMate-server-debug.apk'
Copy-Item -LiteralPath (Join-Path $taskProject 'app/build/outputs/apk/debug/app-debug.apk') -Destination $taskApk -Force
Get-FileHash -LiteralPath $taskApk -Algorithm SHA256
Write-Output "Server APK: $taskApk"
