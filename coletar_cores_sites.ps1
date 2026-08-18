param(
    [string]$Entrada = (Join-Path $PSScriptRoot 'orgaos_sites.json'),
    [string]$Saida = (Join-Path $PSScriptRoot 'orgaos_sites_cores.json'),
    [string]$Chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe',
    [int]$TempoVirtualMs = 8000,
    [int]$Tentativas = 2
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Entrada -PathType Leaf)) {
    throw "Arquivo de entrada nao encontrado: $Entrada"
}

if (-not (Test-Path -LiteralPath $Chrome -PathType Leaf)) {
    throw "Google Chrome nao encontrado: $Chrome"
}

$conteudoEntrada = [IO.File]::ReadAllText(
    [IO.Path]::GetFullPath($Entrada),
    [Text.Encoding]::UTF8
)
$orgaos = [object[]]($conteudoEntrada | ConvertFrom-Json)
$perfil = Join-Path ([IO.Path]::GetTempPath()) 'barco-coletor-cores-chrome'
$domTemporario = Join-Path ([IO.Path]::GetTempPath()) 'barco-coletor-cores-dom.html'
$erroTemporario = Join-Path ([IO.Path]::GetTempPath()) 'barco-coletor-cores-chrome.log'

function Obter-CorSolida {
    param([Parameter(Mandatory)][string]$Url)

    for ($tentativa = 1; $tentativa -le $Tentativas; $tentativa++) {
        [IO.File]::WriteAllText($domTemporario, '')
        [IO.File]::WriteAllText($erroTemporario, '')

        $argumentos = @(
            '--headless=new'
            '--disable-gpu'
            '--disable-extensions'
            '--disable-sync'
            '--no-first-run'
            '--no-default-browser-check'
            "--user-data-dir=$perfil"
            "--virtual-time-budget=$TempoVirtualMs"
            '--dump-dom'
            $Url
        )

        $processo = Start-Process `
            -FilePath $Chrome `
            -ArgumentList $argumentos `
            -Wait `
            -PassThru `
            -WindowStyle Hidden `
            -RedirectStandardOutput $domTemporario `
            -RedirectStandardError $erroTemporario

        if ($processo.ExitCode -eq 0) {
            $dom = Get-Content -Raw -LiteralPath $domTemporario
            $padroes = @(
                '--p-primary-color:\s*(#[0-9a-fA-F]{6})\s*!important'
                '--p:\s*(#[0-9a-fA-F]{6})\s*!important'
            )

            foreach ($padrao in $padroes) {
                $correspondencia = [regex]::Match($dom, $padrao)
                if ($correspondencia.Success) {
                    return $correspondencia.Groups[1].Value.ToUpperInvariant()
                }
            }
        }
    }

    return $null
}

$resultado = for ($indice = 0; $indice -lt $orgaos.Count; $indice++) {
    $orgao = $orgaos[$indice]
    $numero = $indice + 1
    Write-Host ("[{0}/{1}] {2} - {3}" -f $numero, $orgaos.Count, $orgao.cidade, $orgao.link)

    $cor = Obter-CorSolida -Url $orgao.link
    if ($null -eq $cor) {
        Write-Warning "Cor nao encontrada em $($orgao.link)"
    }
    else {
        Write-Host "  $cor"
    }

    [PSCustomObject]@{
        cidade = $orgao.cidade
        estado = $orgao.estado
        link = $orgao.link
        cor_solida = $cor
    }
}

$json = $resultado | ConvertTo-Json -Depth 5
$utf8SemBom = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText([IO.Path]::GetFullPath($Saida), $json + [Environment]::NewLine, $utf8SemBom)

[IO.File]::Delete($domTemporario)
[IO.File]::Delete($erroTemporario)

$encontradas = @($resultado | Where-Object { $null -ne $_.cor_solida }).Count
Write-Host "Concluido: $encontradas de $($orgaos.Count) cores encontradas."
Write-Host "Arquivo: $([IO.Path]::GetFullPath($Saida))"
