// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's own YARA rules (PolyForm Shield 1.0.0, written for Keeper): common
// download-and-run droppers, web shells, miners and reverse shells. Open rule
// sets the person adds in Settings run alongside these.

export const BUILTIN_RULES = String.raw`
rule Keeper_PowerShell_Download_Cradle {
  meta: description = "PowerShell that downloads code and runs it in memory" severity = "high" confidence = "likely"
  strings:
    $a = "DownloadString" nocase
    $b = "IEX" nocase
    $c = "Invoke-Expression" nocase
    $d = "Net.WebClient" nocase
    $e = "FromBase64String" nocase
  condition: filesize < 2MB and $d and ($a or $e) and ($b or $c)
}

rule Keeper_PHP_Webshell {
  meta: description = "A web shell: a page that lets someone run commands on a server" severity = "high" confidence = "likely"
  strings:
    $p = "<?php" nocase
    $e1 = /eval\s*\(\s*(base64_decode|gzinflate|str_rot13)\s*\(/ nocase
    $e2 = /(system|passthru|shell_exec|exec)\s*\(\s*\$_(GET|POST|REQUEST|COOKIE)/ nocase
    $e3 = /assert\s*\(\s*\$_(GET|POST|REQUEST)/ nocase
  condition: $p and any of ($e*)
}

rule Keeper_Coin_Miner {
  meta: description = "A cryptocurrency miner, which uses your computer's power for someone else" severity = "medium" confidence = "likely"
  strings:
    $s1 = "stratum+tcp://" nocase
    $s2 = "stratum+ssl://" nocase
    $s3 = "--donate-level" nocase
    $s4 = "xmrig" nocase
    $s5 = "randomx" nocase
  condition: 2 of them
}

rule Keeper_Reverse_Shell {
  meta: description = "Opens a connection that lets someone else control this computer" severity = "critical" confidence = "likely"
  strings:
    $b = /bash\s+-i\s+>&\s*\/dev\/tcp\// nocase
    $n = /nc(at)?\s+(-e|-c)\s+\/bin\/(ba)?sh/ nocase
    $p = /socket\.socket\([^)]*\)[\s\S]{0,200}subprocess\.call\(\[?"\/bin\/(ba)?sh"/
    $w = "New-Object System.Net.Sockets.TCPClient" nocase
    $w2 = "GetStream()" nocase
  condition: $b or $n or $p or ($w and $w2)
}

rule Keeper_Office_AutoExec_Downloader {
  meta: description = "A document whose macro runs on opening and downloads something" severity = "high" confidence = "likely"
  strings:
    $vba1 = "vbaProject.bin"
    $vba2 = "_VBA_PROJECT"
    $auto1 = "AutoOpen" nocase
    $auto2 = "Document_Open" nocase
    $auto3 = "Workbook_Open" nocase
    $dl1 = "URLDownloadToFile" nocase
    $dl2 = "MSXML2.XMLHTTP" nocase
    $dl3 = "WinHttp.WinHttpRequest" nocase
  condition: any of ($vba*) and any of ($auto*) and any of ($dl*)
}
`;
