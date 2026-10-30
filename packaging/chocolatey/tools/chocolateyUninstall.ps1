# SPDX-License-Identifier: AGPL-3.0-or-later
$ErrorActionPreference = 'Stop'

Uninstall-BinFile -Name 'keeper'
[array]$keys = Get-UninstallRegistryKey -SoftwareName 'Keeper*' | Where-Object { $_.UninstallString -like '*Uninstall Keeper.exe*' }
foreach ($key in $keys) {
  $file = ($key.UninstallString -replace '^"([^"]+)".*$', '$1')
  Uninstall-ChocolateyPackage -PackageName $env:ChocolateyPackageName -FileType 'exe' -SilentArgs '/S /allusers' -File $file -ValidExitCodes @(0)
}
