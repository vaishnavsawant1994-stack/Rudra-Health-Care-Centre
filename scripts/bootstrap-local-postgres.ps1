# Run from an elevated PowerShell terminal in the project directory.
# Creates local-only Rudra development/test databases and a protected .env.local.
# Uses a temporary loopback-only trust rule to establish a new postgres password,
# then restores pg_hba.conf in a finally block. Never use against a non-disposable cluster.
$ErrorActionPreference = 'Stop'
throw 'Disabled after security review: this script temporarily grants trust access to every PostgreSQL role on loopback and changes the existing cluster administrator password. Use an approved authenticated recovery procedure instead.'

# The implementation below is retained for review only. Do not remove the guard
# until its security and database-role design have been replaced and approved.
$ErrorActionPreference = 'Stop'

$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Open PowerShell as Administrator and rerun this script.'
}

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$envFile = Join-Path $projectRoot '.env.local'
$pgBin = 'C:\PostgreSQL\17\bin'
$dataDir = 'C:\PostgreSQL\17\data'
$pgHba = Join-Path $dataDir 'pg_hba.conf'
$serviceName = 'postgresql-x64-17'
$backup = Join-Path $env:TEMP ('rudra-pg-hba-' + [guid]::NewGuid().ToString('N') + '.tmp')
$utf8 = New-Object System.Text.UTF8Encoding($false)

if (-not (Test-Path (Join-Path $pgBin 'psql.exe')) -or -not (Test-Path $pgHba)) {
  throw 'Expected PostgreSQL 17 at C:\PostgreSQL\17 was not found.'
}
if (Test-Path -LiteralPath $envFile) {
  throw '.env.local already exists. Review it and remove it yourself before bootstrapping; this script will not overwrite it.'
}
$service = Get-Service -Name $serviceName -ErrorAction Stop
if ($service.Status -ne 'Running') { throw 'Start the PostgreSQL service before running this script.' }

$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
function New-HexSecret([int]$byteCount) {
  $buffer = New-Object byte[] $byteCount
  $rng.GetBytes($buffer)
  $value = ([BitConverter]::ToString($buffer)).Replace('-', '')
  [Array]::Clear($buffer, 0, $buffer.Length)
  return $value
}
$adminPassword = New-HexSecret 32
$devPassword = New-HexSecret 32
$testPassword = New-HexSecret 32
$authSecret = New-HexSecret 48
$originalHba = [IO.File]::ReadAllText($pgHba)
[IO.File]::WriteAllText($backup, $originalHba, $utf8)
$env:PGPASSWORD = $adminPassword

try {
  Stop-Service -Name $serviceName -Force
  [IO.File]::WriteAllText($pgHba, "host all all 127.0.0.1/32 trust`r`n" + $originalHba, $utf8)
  Start-Service -Name $serviceName

  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    Start-Sleep -Seconds 1
    & (Join-Path $pgBin 'pg_isready.exe') -h 127.0.0.1 -p 5432 *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  }
  if (-not $ready) { throw 'PostgreSQL did not become ready during setup.' }

  $occupied = & (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p 5432 -U postgres -d postgres -t -A -v ON_ERROR_STOP=1 -c "SELECT (EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('rudra_dev','rudra_test'))) OR (EXISTS (SELECT 1 FROM pg_database WHERE datname IN ('rudra_health_os','rudra_health_os_test')))"
  if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the local PostgreSQL cluster.' }
  if ($occupied.Trim() -ne 'f') { throw 'A Rudra role or database already exists; refusing to overwrite it.' }

  $sql = @"
ALTER ROLE postgres WITH PASSWORD '$adminPassword';
CREATE ROLE rudra_dev LOGIN PASSWORD '$devPassword' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT CONNECTION LIMIT 10;
CREATE ROLE rudra_test LOGIN PASSWORD '$testPassword' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT CONNECTION LIMIT 10;
CREATE DATABASE rudra_health_os OWNER rudra_dev;
CREATE DATABASE rudra_health_os_test OWNER rudra_test;
"@
  $sql | & (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p 5432 -U postgres -d postgres -v ON_ERROR_STOP=1 -q
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the local Rudra roles and databases.' }
}
finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
  [IO.File]::WriteAllText($pgHba, $originalHba, $utf8)
  Start-Service -Name $serviceName -ErrorAction Stop
  Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
}

try {
  $env:PGPASSWORD = $devPassword
  $devCheck = & (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p 5432 -U rudra_dev -d rudra_health_os -t -A -v ON_ERROR_STOP=1 -c "SELECT current_user || ':' || current_database()"
  if ($LASTEXITCODE -ne 0 -or $devCheck.Trim() -ne 'rudra_dev:rudra_health_os') { throw 'Development database connection check failed.' }

  $env:PGPASSWORD = $testPassword
  $testCheck = & (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p 5432 -U rudra_test -d rudra_health_os_test -t -A -v ON_ERROR_STOP=1 -c "SELECT current_user || ':' || current_database()"
  if ($LASTEXITCODE -ne 0 -or $testCheck.Trim() -ne 'rudra_test:rudra_health_os_test') { throw 'Test database connection check failed.' }

  $lines = @(
    '# Local development only. Do not commit this file.',
    "DATABASE_URL=postgresql://rudra_dev:$devPassword@127.0.0.1:5432/rudra_health_os",
    "DATABASE_TEST_URL=postgresql://rudra_test:$testPassword@127.0.0.1:5432/rudra_health_os_test",
    "BETTER_AUTH_SECRET=$authSecret",
    'BETTER_AUTH_URL=http://localhost:3000',
    'RUDRA_BOOTSTRAP_ENABLED=0'
  )
  [IO.File]::WriteAllLines($envFile, $lines, $utf8)

  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $acl = New-Object System.Security.AccessControl.FileSecurity
  $acl.SetAccessRuleProtection($true, $false)
  $acl.SetOwner((New-Object System.Security.Principal.NTAccount($identity)))
  foreach ($account in @($identity, 'NT AUTHORITY\SYSTEM', 'BUILTIN\Administrators')) {
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($account, 'FullControl', 'Allow')
    $acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $envFile -AclObject $acl
  Write-Output 'Local Rudra development/test databases created; app credentials saved in protected .env.local.'
}
finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  $adminPassword = $null; $devPassword = $null; $testPassword = $null; $authSecret = $null
  $rng.Dispose()
}
