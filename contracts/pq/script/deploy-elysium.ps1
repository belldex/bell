param([switch]$Broadcast)
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$contractsRoot = Join-Path $repoRoot 'contracts'
$envFile = Join-Path $contractsRoot '.env'
$keyDir = Join-Path $contractsRoot 'pq\keys\elysium-99801'

if (-not (Test-Path -LiteralPath $envFile)) { throw 'contracts/.env is missing.' }
foreach ($name in @('ELYSIUM_DEPLOYER_PRIVATE_KEY','ELYSIUM_REPORTER_PRIVATE_KEY','ELYSIUM_GUARDIAN_PRIVATE_KEY')) {
    $line = Get-Content -LiteralPath $envFile | Where-Object { $_ -match "^\s*$name\s*=" } | Select-Object -First 1
    if (-not $line) { throw "Required variable $name is missing in contracts/.env." }
    $value = ($line -replace '^\s*[A-Z0-9_]+\s*=\s*', '').Trim().Trim('"').Trim("'")
    Set-Item -Path "Env:$name" -Value $value
}
$keeperLine = Get-Content -LiteralPath (Join-Path $repoRoot '.env') | Where-Object { $_ -match '^\s*KEEPER_A_PRIVATE_KEY\s*=' } | Select-Object -First 1
if (-not $keeperLine) { throw 'Required variable KEEPER_A_PRIVATE_KEY is missing in repo .env.' }
$keeperKey = ($keeperLine -replace '^\s*KEEPER_A_PRIVATE_KEY\s*=\s*', '').Trim().Trim('"').Trim("'")
if ($keeperKey -match '^[0-9a-fA-F]{64}$') { $keeperKey = '0x' + $keeperKey }
Set-Item -Path 'Env:KEEPER_A_PRIVATE_KEY' -Value $keeperKey

$commitments = @(
    @{ role = 'keeper'; variable = 'PQ_KEEPER_COMMITMENT' },
    @{ role = 'reporter'; variable = 'PQ_REPORTER_COMMITMENT' },
    @{ role = 'governance'; variable = 'PQ_GOVERNANCE_COMMITMENT' },
    @{ role = 'guardian'; variable = 'PQ_GUARDIAN_COMMITMENT' }
)
foreach ($entry in $commitments) {
    $metadataPath = Join-Path $keyDir ($entry.role + '.public.json')
    if (-not (Test-Path -LiteralPath $metadataPath)) { throw "Missing generated public key for $($entry.role)." }
    $metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
    Set-Item -Path "Env:$($entry.variable)" -Value $metadata.publicKeyCommitment
}

$forgeArgs = @(
    'exec','forge','script','--root','contracts',
    'contracts/pq/script/DeployPQTestnet.s.sol:DeployPQTestnet',
    '--rpc-url','https://testnet-rpc.elysium.kinetiq.xyz','-vvvv'
)
if ($Broadcast) { $forgeArgs += '--broadcast' }
$previousProfile = $env:FOUNDRY_PROFILE
$env:FOUNDRY_PROFILE = 'pq_testnet'
Push-Location $repoRoot
try { & pnpm @forgeArgs; $forgeExit = $LASTEXITCODE } finally {
    Pop-Location
    if ($previousProfile) { $env:FOUNDRY_PROFILE = $previousProfile }
    else { Remove-Item Env:FOUNDRY_PROFILE -ErrorAction SilentlyContinue }
}
exit $forgeExit
