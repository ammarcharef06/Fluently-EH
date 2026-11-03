param(
    [Parameter(Mandatory = $true)]
    [string]$InstallerPath,

    [ValidateRange(5, 120)]
    [int]$StartupTimeoutSeconds = 30
)

$ErrorActionPreference = "Stop"

$workspace = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$installer = (Resolve-Path $InstallerPath).Path
if (!(Test-Path -LiteralPath $installer -PathType Leaf)) {
    throw "Installer file does not exist: $installer"
}

$localAppData = [System.IO.Path]::GetFullPath($env:LOCALAPPDATA)
$installDirectory = Join-Path $localAppData "Fluently-H2B-QA"
$installFullPath = [System.IO.Path]::GetFullPath($installDirectory)
if (!$installFullPath.StartsWith($localAppData, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "The QA install directory must remain inside the current user's LocalAppData directory."
}

if (Test-Path -LiteralPath $installFullPath) {
    Remove-Item -LiteralPath $installFullPath -Recurse -Force
}

$installerHash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash
$installerSize = (Get-Item -LiteralPath $installer).Length

$installProcess = Start-Process -FilePath $installer -ArgumentList @("/S", "/D=$installFullPath") -Wait -PassThru
if ($installProcess.ExitCode -ne 0) {
    throw "The per-user NSIS installer failed with exit code $($installProcess.ExitCode)."
}

$appExecutable = Join-Path $installFullPath "fluently-desktop.exe"
if (!(Test-Path -LiteralPath $appExecutable -PathType Leaf)) {
    $installedFiles = Get-ChildItem -LiteralPath $installFullPath -File -Recurse | Select-Object -ExpandProperty FullName
    throw "The installer completed but fluently-desktop.exe was not found. Installed files: $($installedFiles -join '; ')"
}

$resourceLesson = Join-Path $installFullPath "curriculum\lessons\pre-a1-integrity-fixture.json"
if (!(Test-Path -LiteralPath $resourceLesson -PathType Leaf)) {
    $installedFiles = Get-ChildItem -LiteralPath $installFullPath -File -Recurse | Select-Object -ExpandProperty FullName
    throw "The embedded curriculum fixture was not installed at the expected resource path. Installed files: $($installedFiles -join '; ')"
}

$appHash = (Get-FileHash -LiteralPath $appExecutable -Algorithm SHA256).Hash
$originalLessonBytes = [System.IO.File]::ReadAllBytes($resourceLesson)
$appProcess = $null
$tamperedProcess = $null
$windowTitle = $null
$tamperExitCode = $null
try {
    # First prove that the untouched installed payload starts successfully.
    $appProcess = Start-Process -FilePath $appExecutable -WorkingDirectory $installFullPath -PassThru
    $deadline = [DateTime]::UtcNow.AddSeconds($StartupTimeoutSeconds)
    do {
        Start-Sleep -Seconds 1
        $appProcess.Refresh()
        if ($appProcess.HasExited) {
            throw "Fluently exited during clean-payload startup with code $($appProcess.ExitCode)."
        }
        if ($appProcess.MainWindowHandle -ne [IntPtr]::Zero) {
            $windowTitle = $appProcess.MainWindowTitle
            if ($windowTitle -like "*Fluently*") { break }
        }
    } while ([DateTime]::UtcNow -lt $deadline)

    if ([string]::IsNullOrWhiteSpace($windowTitle) -or $windowTitle -notlike "*Fluently*") {
        throw "Fluently did not show its main window with the untouched embedded payload."
    }

    Stop-Process -Id $appProcess.Id -Force
    $appProcess = $null

    # Change exactly one installed lesson byte. Startup must fail closed.
    $tamperedBytes = [byte[]]($originalLessonBytes.Clone())
    $tamperedBytes[20] = [byte]($tamperedBytes[20] -bxor 1)
    [System.IO.File]::WriteAllBytes($resourceLesson, $tamperedBytes)

    try {
        $tamperedProcess = Start-Process -FilePath $appExecutable -WorkingDirectory $installFullPath -PassThru
        $tamperDeadline = [DateTime]::UtcNow.AddSeconds($StartupTimeoutSeconds)
        do {
            Start-Sleep -Seconds 1
            $tamperedProcess.Refresh()
            if ($tamperedProcess.HasExited) {
                break
            }
        } while ([DateTime]::UtcNow -lt $tamperDeadline)

        $tamperedProcess.Refresh()
        if (!$tamperedProcess.HasExited) {
            throw "Fluently remained running after the tamper startup timeout of $StartupTimeoutSeconds seconds."
        }
        $tamperExitCode = $tamperedProcess.ExitCode
        if ($tamperExitCode -eq 0) {
            throw "Fluently exited successfully after the installed curriculum payload was modified."
        }
    }
    finally {
        if ($null -ne $tamperedProcess) {
            $tamperedProcess.Refresh()
            if (!$tamperedProcess.HasExited) {
                Stop-Process -Id $tamperedProcess.Id -Force
            }
            $tamperedProcess = $null
        }
        [System.IO.File]::WriteAllBytes($resourceLesson, $originalLessonBytes)
    }

    # Restoring the exact bytes must restore successful startup.
    $appProcess = Start-Process -FilePath $appExecutable -WorkingDirectory $installFullPath -PassThru
    $deadline = [DateTime]::UtcNow.AddSeconds($StartupTimeoutSeconds)
    $windowTitle = $null
    do {
        Start-Sleep -Seconds 1
        $appProcess.Refresh()
        if ($appProcess.HasExited) {
            throw "Fluently failed to restart after the original curriculum payload was restored (exit $($appProcess.ExitCode))."
        }
        if ($appProcess.MainWindowHandle -ne [IntPtr]::Zero) {
            $windowTitle = $appProcess.MainWindowTitle
            if ($windowTitle -like "*Fluently*") { break }
        }
    } while ([DateTime]::UtcNow -lt $deadline)

    if ([string]::IsNullOrWhiteSpace($windowTitle) -or $windowTitle -notlike "*Fluently*") {
        throw "Fluently did not show its main window after restoring the original curriculum payload."
    }

    $report = @(
        "Result: PASS"
        "Install mode: current user"
        "Install directory: $installFullPath"
        "Installer SHA-256: $installerHash"
        "Installer size bytes: $installerSize"
        "Installed executable: $appExecutable"
        "Executable SHA-256: $appHash"
        "Embedded curriculum manifest: verified at application startup"
        "Embedded curriculum clean payload: accepted and application window shown"
        "Embedded curriculum tamper test: one lesson byte changed; application exited with code $tamperExitCode"
        "Embedded curriculum restore test: original bytes restored; application window shown"
        "Process ID: $($appProcess.Id)"
        "Window title: $windowTitle"
        "Startup timeout seconds: $StartupTimeoutSeconds"
        "Authenticode: unsigned QA artifact; no trust claim"
    ) -join [Environment]::NewLine

    $reportPath = Join-Path $workspace "h2b-windows-install-smoke.txt"
    Set-Content -LiteralPath $reportPath -Value $report -Encoding utf8
    if ($env:GITHUB_STEP_SUMMARY) {
        $summary = [Environment]::NewLine + "## Windows install/runtime and curriculum integrity smoke test" + [Environment]::NewLine + [Environment]::NewLine + $report
        Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY -Value $summary
    }
    Write-Output $report
}
finally {
    if ($null -ne $tamperedProcess) {
        $tamperedProcess.Refresh()
        if (!$tamperedProcess.HasExited) { Stop-Process -Id $tamperedProcess.Id -Force }
    }
    # Always restore the installed fixture, including on a failed assertion.
    [System.IO.File]::WriteAllBytes($resourceLesson, $originalLessonBytes)
    if ($null -ne $appProcess) {
        $appProcess.Refresh()
        if (!$appProcess.HasExited) { Stop-Process -Id $appProcess.Id -Force }
    }
}
