# SPDX-License-Identifier: AGPL-3.0-or-later
# Installs Keeper on Windows.
#
#   irm https://raw.githubusercontent.com/ashfordeOU/keeper/main/scripts/install.ps1 | iex
#
# With options (piping into iex cannot pass them, so run it as a script block):
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/ashfordeOU/keeper/main/scripts/install.ps1))) -Portable
#
#   -Version X      install a specific version (default: the latest release)
#   -Portable       the portable Keeper.exe instead of the installer (no admin rights, no auto-update)
#   -Uninstall      remove Keeper (the app, the keeper command, shortcuts; your files are untouched)
#   -DownloadOnly   download and verify the installer into the current folder, then stop
#
# The installer is per-user, so no administrator prompt. Every download is checked
# against the release's SHA256SUMS.txt; when the GitHub CLI is installed and signed
# in, the build attestation is verified as well.
# Environment: KEEPER_VERSION, KEEPER_PORTABLE=1, KEEPER_UNINSTALL=1, KEEPER_RELEASES_API.

[CmdletBinding()]
param(
  [string]$Version = $env:KEEPER_VERSION,
  [switch]$Portable = ($env:KEEPER_PORTABLE -eq '1'),
  [switch]$Uninstall = ($env:KEEPER_UNINSTALL -eq '1'),
  [switch]$DownloadOnly
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # Invoke-WebRequest is many times slower with the progress bar
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Repo = 'ashfordeOU/keeper'
$Api = if ($env:KEEPER_RELEASES_API) { $env:KEEPER_RELEASES_API } else { "https://api.github.com/repos/$Repo" }
$Version = if ($Version) { $Version.TrimStart('v') } else { 'latest' }
$LocalData = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { [Environment]::GetFolderPath('LocalApplicationData') }
$RoamingData = if ($env:APPDATA) { $env:APPDATA } else { [Environment]::GetFolderPath('ApplicationData') }
$Programs = Join-Path $LocalData 'Programs'
$AppDir = Join-Path $Programs 'Keeper'
$PortableDir = Join-Path $Programs 'Keeper Portable'
$BinDir = Join-Path $LocalData 'Keeper\bin'
$StartMenu = Join-Path $RoamingData 'Microsoft\Windows\Start Menu\Programs'

function Say([string]$Text) { Write-Host $Text }
function Step([string]$Text) { Write-Host "==> $Text" -ForegroundColor Cyan }
function Fail([string]$Text) { throw "Keeper installer: $Text" }

function Get-Release {
  $url = if ($Version -eq 'latest') { "$Api/releases/latest" } else { "$Api/releases/tags/v$Version" }
  try { Invoke-RestMethod -Uri $url -Headers @{ 'User-Agent' = 'keeper-installer' } }
  catch { Fail "could not read the release information ($url): $($_.Exception.Message)" }
}

function Get-VerifiedAsset($Release, [string]$Name, [string]$Folder) {
  $asset = $Release.assets | Where-Object { $_.name -eq $Name } | Select-Object -First 1
  if (-not $asset) { Fail "release $($Release.tag_name) has no $Name" }
  $path = Join-Path $Folder $Name
  Step "Downloading $Name"
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $path -UseBasicParsing
  $sums = $Release.assets | Where-Object { $_.name -eq 'SHA256SUMS.txt' } | Select-Object -First 1
  if ($sums) {
    $text = (Invoke-WebRequest -Uri $sums.browser_download_url -UseBasicParsing).Content
    if ($text -is [byte[]]) { $text = [Text.Encoding]::UTF8.GetString($text) }
    $line = ($text -split "`n") | Where-Object { $_ -match "^([0-9a-fA-F]{64})\s+\*?$([regex]::Escape($Name))\s*$" } | Select-Object -First 1
    if (-not $line) { Remove-Item $path -Force; Fail "$Name is not listed in SHA256SUMS.txt" }
    $want = ($line -split '\s+')[0].ToLowerInvariant()
    $got = (Get-FileHash -Algorithm SHA256 -Path $path).Hash.ToLowerInvariant()
    if ($want -ne $got) {
      Remove-Item $path -Force
      Fail "checksum mismatch for $Name (expected $want, got $got). The download is corrupt or was tampered with; nothing was installed."
    }
    Say "Checksum OK ($got)"
  } else {
    Say 'Warning: this release has no SHA256SUMS.txt, so the download could not be checked.'
  }
  if ((Get-Command gh -ErrorAction SilentlyContinue) -and $env:KEEPER_VERIFY_ATTESTATION -ne '0') {
    & gh auth status *> $null
    if ($LASTEXITCODE -eq 0) {
      & gh attestation verify $path --repo $Repo *> $null
      if ($LASTEXITCODE -ne 0) { Fail "the build attestation for $Name could not be verified (set KEEPER_VERIFY_ATTESTATION=0 to skip)" }
      Say "Build attestation verified: built by $Repo on GitHub Actions"
    }
  }
  $path
}

function Set-UserPath([string]$Dir, [bool]$Present) {
  $current = [Environment]::GetEnvironmentVariable('Path', 'User')
  $parts = @(if ($current) { $current -split ';' | Where-Object { $_ -and $_ -ne $Dir } })
  if ($Present) { $parts += $Dir }
  [Environment]::SetEnvironmentVariable('Path', ($parts -join ';'), 'User')
  if ($Present -and ($env:Path -split ';') -notcontains $Dir) { $env:Path = "$env:Path;$Dir" }
}

# `keeper` in a terminal runs the command bundled inside the app, on the app's own runtime.
function Write-Shim {
  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
  $shim = @(
    '@echo off',
    'rem Keeper command shim, written by Keeper''s installer. With no arguments it opens the app.',
    "if `"%~1`"==`"`" (start `"`" `"$AppDir\Keeper.exe`" & exit /b)",
    'setlocal',
    'set ELECTRON_RUN_AS_NODE=1',
    "`"$AppDir\Keeper.exe`" `"$AppDir\resources\app.asar\dist-cli\keeper.cjs`" %*"
  ) -join "`r`n"
  Set-Content -Path (Join-Path $BinDir 'keeper.cmd') -Value $shim -Encoding ASCII
  Set-UserPath $BinDir $true
}

function Stop-Keeper {
  Get-Process -Name 'Keeper' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

function Install-Keeper {
  if (-not [Environment]::Is64BitOperatingSystem) { Fail 'Keeper needs 64-bit Windows.' }
  $release = Get-Release
  Say "Installing Keeper $($release.tag_name)"
  $name = if ($Portable) { 'Keeper-portable.exe' } else { 'Keeper-setup-x64.exe' }
  if ($DownloadOnly) {
    $path = Get-VerifiedAsset $release $name (Get-Location).Path
    Say "Downloaded and verified: $path"
    return
  }
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("keeper-install-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  try {
    $path = Get-VerifiedAsset $release $name $tmp
    Stop-Keeper
    if ($Portable) {
      New-Item -ItemType Directory -Force -Path $PortableDir | Out-Null
      $exe = Join-Path $PortableDir 'Keeper.exe'
      Copy-Item $path $exe -Force
      $lnk = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $StartMenu 'Keeper (portable).lnk'))
      $lnk.TargetPath = $exe
      $lnk.Save()
      Say "Keeper (portable) is in $PortableDir and in the Start menu. It tells you about new versions but does not update itself."
      Say 'For the keeper command with the portable app, run: npm install -g keeper-cli'
    } else {
      Step 'Running the installer'
      $p = Start-Process -FilePath $path -ArgumentList '/S' -Wait -PassThru
      if ($p.ExitCode -ne 0) { Fail "the installer exited with code $($p.ExitCode)" }
      if (-not (Test-Path (Join-Path $AppDir 'Keeper.exe'))) { Fail "the installer finished but $AppDir\Keeper.exe is missing" }
      Write-Shim
      Say 'Keeper is installed. Find it in the Start menu, or run: keeper'
      Say 'It updates itself; open a new terminal for the keeper command.'
    }
  } finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  }
}

function Uninstall-Keeper {
  Step 'Removing Keeper'
  Stop-Keeper
  $removed = $false
  $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
  $entry = Get-ItemProperty $key -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'Keeper*' -and $_.UninstallString } | Select-Object -First 1
  $uninstaller = Join-Path $AppDir 'Uninstall Keeper.exe'
  if ($entry -and $entry.QuietUninstallString) {
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $entry.QuietUninstallString -Wait | Out-Null; $removed = $true
  } elseif (Test-Path $uninstaller) {
    Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait | Out-Null; $removed = $true
  }
  if (Test-Path $PortableDir) { Remove-Item -Recurse -Force $PortableDir; $removed = $true }
  $portableLink = Join-Path $StartMenu 'Keeper (portable).lnk'
  if (Test-Path $portableLink) { Remove-Item -Force $portableLink }
  $shim = Join-Path $BinDir 'keeper.cmd'
  if ((Test-Path $shim) -and (Select-String -Path $shim -Pattern 'Keeper command shim' -Quiet)) {
    Remove-Item -Force $shim; $removed = $true
    if (-not (Get-ChildItem $BinDir -ErrorAction SilentlyContinue)) { Remove-Item -Force $BinDir -ErrorAction SilentlyContinue }
  }
  Set-UserPath $BinDir $false
  if ($removed) { Say 'Keeper has been removed.' } else { Say 'Keeper was not installed by this script (nothing to remove).' }
  Say "Your settings stay in place; delete them too with: Remove-Item -Recurse `"$RoamingData\Keeper`""
}

if (-not $IsWindows -and $PSVersionTable.PSEdition -eq 'Core' -and -not $DownloadOnly) {
  Fail 'this script is for Windows. On macOS or Linux run: curl -fsSL https://raw.githubusercontent.com/ashfordeOU/keeper/main/scripts/install.sh | sh'
}
if ($Uninstall) { Uninstall-Keeper } else { Install-Keeper }
