$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
function New-RandomSecret {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    return [Convert]::ToHexString($bytes).ToLowerInvariant()
}
$rootEnv = Join-Path $projectRoot '.env'
$backendEnv = Join-Path $projectRoot 'backend/.env'
if (Test-Path -LiteralPath $rootEnv) { throw '.env already exists. Setup will not overwrite it.' }
if (Test-Path -LiteralPath $backendEnv) { throw 'backend/.env already exists. Setup will not overwrite it.' }
$dbPassword = New-RandomSecret
$jwtSecret = New-RandomSecret
@"
POSTGRES_DB=rentmate
POSTGRES_USER=rentmate
POSTGRES_PASSWORD=$dbPassword
JWT_SECRET=$jwtSecret
PORT=3000
CLOUDINARY_URL=
"@ | Set-Content -LiteralPath $rootEnv -Encoding utf8
@"
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://rentmate:$dbPassword@localhost:5432/rentmate
JWT_SECRET=$jwtSecret
JWT_TTL=8h
CLOUDINARY_URL=
GOOGLE_APPLICATION_CREDENTIALS=
"@ | Set-Content -LiteralPath $backendEnv -Encoding utf8
Write-Host 'Created local environment files with generated secrets. Start Docker Desktop, then run docker compose up --build.'
