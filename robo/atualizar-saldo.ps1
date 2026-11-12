# ═══════════════════════════════════════════════════════════════
#  ROBÔ DO SALDO · Excel do ERP → Saldo mapeado (Supabase)
#
#  1. Abre a planilha do ERP num Excel escondido
#  2. Atualiza as consultas (o mesmo que Dados > Atualizar Tudo)
#  3. Confere se a consulta atualizou mesmo (senão, não envia nada)
#  4. Manda as linhas para o Supabase, que troca a foto do saldo
#  5. Fecha o Excel e anota o resultado no arquivo de log
#
#  Quem chama este script é o Agendador de Tarefas do Windows.
#  Para testar na mão: botão direito no arquivo > Executar com o
#  PowerShell, e depois abra o log.
# ═══════════════════════════════════════════════════════════════

param([switch]$Agora)   # -Agora = roda já, sem perguntar se é a vez (instalador e atalho)

# ─────────────── CONFIGURE AQUI ───────────────
$Planilha = 'C:\RoboSaldo\LOTES_SB8.xlsx'       # caminho da planilha do ERP
$Aba      = 'SB8_SALDOS_LOTES'                  # nome da aba com o saldo por lote
$Supabase = 'https://yuaboypybjqxxgntfyrq.supabase.co'
$ArqChave = 'C:\RoboSaldo\chave-supabase.txt'   # a chave SECRETA (sb_secret_...), só nesta máquina
$Log      = 'C:\RoboSaldo\atualizar-saldo.log'
# Filiais deste armazém (B8_FILIAL). A planilha do ERP traz todas as
# filiais da empresa; só estas vão para o sistema. Vazio @() = todas.
$Filiais  = @('010001', '020006', '090010')
# Tipos de produto (B1_TIPO) que vão: produto acabado e mercadoria.
# Vazio @() = todos.
$Tipos    = @('PA', 'ME')
# Atualização automática: o Agendador acorda o robô a cada 5 min e ele só
# roda se já passou $IntervaloMin desde a última vez, entre $HoraIni e $HoraFim
# (hora cheia, Brasília). Pedido pelo painel roda a qualquer hora.
$IntervaloMin = 60
$HoraIni      = 6
$HoraFim      = 19
# ──────────────────────────────────────────────

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Anotar($msg) {
  # Uma linha por registro: mensagem do Excel costuma vir com quebra de
  # linha no fim, e aí a última linha do log ficava vazia.
  $msg = ("$msg" -replace '\s*[\r\n]+\s*', ' ').Trim()
  "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg" | Add-Content -Path $Log -Encoding UTF8
}

# Colunas que o sistema usa (cabeçalho da planilha -> nome no envio).
# O cabeçalho é comparado sem acento e sem diferença de maiúscula, então
# "Data de Fabricação" e "data de fabricacao" valem igual. As outras
# colunas da planilha são ignoradas.
$Mapa = @{
  'b8_filial'='B8_FILIAL'; 'b1_tipo'='B1_TIPO'; 'b8_produto'='B8_PRODUTO'; 'b1_desc'='B1_DESC'; 'b1_um'='B1_UM'
  'b8_lotectl'='B8_LOTECTL'; 'b8_saldo'='B8_SALDO'; 'b8_empenho'='B8_EMPENHO'; 'b8_local'='B8_LOCAL'
  'data de fabricacao'='DT_FABRICACAO'; 'data de validade'='DT_VALIDADE'
  'b8_dfabric'='DT_FABRICACAO'; 'b8_dtvalid'='DT_VALIDADE'
  'paletes'='PALETES'; 'cxs'='CXS'
}
$Obrigatorias = 'B8_PRODUTO','B8_LOTECTL','B8_SALDO','B8_LOCAL'

# POST no Supabase devolvendo o código HTTP e o texto da resposta, sem
# esconder o corpo do erro. (O Invoke-RestMethod do Windows PowerShell
# 5.1 joga fora a mensagem do banco e mostra só "(400) Solicitação
# Incorreta" — e é a mensagem que explica o que houve.)
function Chamar-Supabase($url, $chave, [byte[]]$corpo) {
  $req = [Net.HttpWebRequest]::Create($url)
  $req.Method = 'POST'
  $req.ContentType = 'application/json; charset=utf-8'
  $req.Timeout = 300000
  $req.ReadWriteTimeout = 300000
  $req.Headers['apikey'] = $chave
  # Chave antiga (começa com eyJ) também precisa ir no Authorization.
  if ($chave.StartsWith('eyJ')) { $req.Headers['Authorization'] = "Bearer $chave" }
  $s = $req.GetRequestStream(); $s.Write($corpo, 0, $corpo.Length); $s.Close()
  $resp = $null
  try { $resp = $req.GetResponse() }
  catch {
    $we = $_.Exception
    while ($we -and -not ($we -is [Net.WebException])) { $we = $we.InnerException }
    if (-not $we -or -not $we.Response) { throw }   # sem resposta: rede, DNS, TLS
    $resp = $we.Response
  }
  $leitor = New-Object IO.StreamReader($resp.GetResponseStream(), [Text.Encoding]::UTF8)
  $texto = $leitor.ReadToEnd(); $leitor.Close()
  $st = [int]$resp.StatusCode; $resp.Close()
  return [pscustomobject]@{ status = $st; corpo = $texto }
}

function Sem-Acento($s) {
  ("$s".Normalize([Text.NormalizationForm]::FormD) -replace '\p{Mn}', '').ToLower().Trim()
}

# Cabeçalhos da primeira linha da aba, já sem acento, minúsculos e sem
# espaço nas pontas (" B8_SALDO " vira "b8_saldo").
function Cabecalhos($w) {
  $faixa = $w.UsedRange
  $n = $faixa.Columns.Count
  $v = $faixa.Rows(1).Value2
  $out = @()
  if ($n -eq 1) { $out += (Sem-Acento $v) }
  else { for ($j = 1; $j -le $n; $j++) { $out += (Sem-Acento $v[1, $j]) } }
  return $out
}

# Para achar e fechar o Excel do robô se ele ficar travado.
Add-Type -Namespace Robo -Name Janela -MemberDefinition '[DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(System.IntPtr hWnd, out int pid);' -ErrorAction SilentlyContinue
$ArqPid = Join-Path (Split-Path -Parent $Log) 'excel-robo.pid'


# Log grande demais (o robô roda o ano todo): guarda o antigo e começa outro.
try { if ((Test-Path $Log) -and (Get-Item $Log).Length -gt 2MB) { Move-Item $Log "$Log.antigo" -Force } } catch {}

# ── Portão: é a minha vez? (o Agendador chama a cada 5 min) ──
$chaveRobo = $null; $comControle = $false; $motivo = 'manual'
try {
  if (-not (Test-Path $ArqChave)) { throw "Arquivo da chave não encontrado: $ArqChave" }
  $chaveRobo = (Get-Content $ArqChave -Raw).Trim()
  $b = ConvertTo-Json -Compress -InputObject @{ p_intervalo = $IntervaloMin; p_hora_ini = $HoraIni; p_hora_fim = $HoraFim; p_forcar = [bool]$Agora }
  $g = Chamar-Supabase "$Supabase/rest/v1/rpc/robo_vez" $chaveRobo ([Text.Encoding]::UTF8.GetBytes($b))
  if ($g.status -ge 200 -and $g.status -lt 300) {
    $v = $g.corpo | ConvertFrom-Json
    if (-not $v.rodar) {
      # Agendado: sai quieto. Na mão (-Agora): diz por que não rodou.
      if ($Agora) {
        $m = 'Já tem uma atualização em andamento (começou há menos de 40 min). Esta foi ignorada.'
        Anotar "Aviso: $m"; Write-Host $m -ForegroundColor Yellow
      }
      exit 0
    }
    $comControle = $true; $motivo = $v.motivo
  }
  elseif ($g.status -eq 404 -or $g.corpo -match 'PGRST202|42883|Could not find') {
    # SQL do pedido manual ainda não foi rodado: usa o relógio local.
    # Conta da última TENTATIVA (não do último OK): se der erro, não fica
    # abrindo o Excel a cada 5 min, e também não roda duas vezes juntas.
    $arqTent = Join-Path (Split-Path $Log) 'ultima-tentativa.txt'
    $h = (Get-Date).Hour
    if (-not $Agora) {
      if ($h -lt $HoraIni -or $h -ge $HoraFim) { exit 0 }
      if ((Test-Path $arqTent) -and ((Get-Date) - (Get-Item $arqTent).LastWriteTime).TotalMinutes -lt $IntervaloMin) { exit 0 }
    }
    Set-Content -Path $arqTent -Value (Get-Date -Format s)
    $motivo = 'sem-controle'
  }
  else { throw "robo_vez respondeu $($g.status): $($g.corpo)" }
}
catch { Anotar "ERRO ao consultar o Supabase: $($_.Exception.Message)"; exit 1 }

function Fim-Robo($status, $msg) {
  if (-not $comControle) { return }
  try {
    $b = ConvertTo-Json -Compress -InputObject @{ p_status = $status; p_msg = "$msg" }
    [void](Chamar-Supabase "$Supabase/rest/v1/rpc/robo_fim" $chaveRobo ([Text.Encoding]::UTF8.GetBytes($b)))
  } catch {}
}

$excel  = $null
$livro  = $null
$pidExcel = 0
$falhou = $false
$inicio = Get-Date

try {
  Anotar "Início ($motivo)"
  if (-not (Test-Path $Planilha)) { throw "Planilha não encontrada: $Planilha" }
  if (-not (Test-Path $ArqChave)) { throw "Arquivo da chave não encontrado: $ArqChave" }
  $chave = $chaveRobo

  # ── 0. Excel do robô que ficou travado na vez anterior: fecha. Só fecha
  #       se for o MESMO processo (começou antes de o robô anotar o número),
  #       nunca um Excel que alguém abriu depois.
  if (Test-Path $ArqPid) {
    $velho = $null
    try { $velho = Get-Process -Id ([int](Get-Content $ArqPid -Raw).Trim()) -ErrorAction Stop } catch {}
    if ($velho -and $velho.ProcessName -eq 'EXCEL' -and $velho.StartTime -le (Get-Item $ArqPid).LastWriteTime) {
      Stop-Process -Id $velho.Id -Force
      Anotar "Aviso: fechei o Excel do robô que tinha ficado travado na execução anterior."
      Start-Sleep -Seconds 2
    }
    Remove-Item $ArqPid -Force -ErrorAction SilentlyContinue
  }

  # ── 1. Excel escondido, só deste robô (não mexe no Excel de quem está usando o PC)
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.AskToUpdateLinks = $false
  try { [void][Robo.Janela]::GetWindowThreadProcessId([IntPtr]$excel.Hwnd, [ref]$pidExcel); Set-Content $ArqPid $pidExcel } catch {}
  $livro = $excel.Workbooks.Open($Planilha)

  # ── 2. Acha a aba do saldo. Se o nome configurado não existir, usa a
  #       primeira aba que tenha as quatro colunas obrigatórias na linha 1.
  $folha = $null
  foreach ($w in $livro.Worksheets) { if ($w.Name -eq $Aba) { $folha = $w } }
  if (-not $folha) {
    foreach ($w in $livro.Worksheets) {
      $cab = Cabecalhos $w
      $ok = 0
      foreach ($c in 'b8_produto','b8_lotectl','b8_saldo','b8_local') { if ($cab -contains $c) { $ok++ } }
      if ($ok -eq 4) { $folha = $w; break }
    }
    if (-not $folha) { throw "Nenhuma aba com B8_PRODUTO, B8_LOTECTL, B8_SALDO e B8_LOCAL na primeira linha (procurei a aba '$Aba' e todas as outras)." }
    Anotar "Aviso: a aba '$Aba' não existe; usei a aba '$($folha.Name)'."
  }

  # ── 3. Atualiza SÓ a consulta que enche essa aba (as outras consultas da
  #       planilha — pedidos, itens — não precisam e demoram muito).
  $conexoes = @()
  foreach ($lo in $folha.ListObjects) {
    try { $wc = $lo.QueryTable.WorkbookConnection; if ($wc) { $conexoes += $wc } } catch {}
  }
  foreach ($qt in $folha.QueryTables) { try { if ($qt.WorkbookConnection) { $conexoes += $qt.WorkbookConnection } } catch {} }
  if ($conexoes.Count -eq 0) {
    foreach ($c in $livro.Connections) { if ($c.Name -like "*$($folha.Name)*") { $conexoes += $c } }
  }
  if ($conexoes.Count -eq 0) {
    Anotar "Aviso: não achei a consulta da aba '$($folha.Name)'; atualizando todas."
    foreach ($c in $livro.Connections) { $conexoes += $c }
  }
  foreach ($c in $conexoes) {
    try { $c.OLEDBConnection.BackgroundQuery = $false } catch {}
    try { $c.ODBCConnection.BackgroundQuery  = $false } catch {}
    $t0 = Get-Date
    $c.Refresh()
    Anotar "Consulta '$($c.Name)' atualizada em $([int]((Get-Date) - $t0).TotalSeconds)s"
  }
  $excel.CalculateUntilAsyncQueriesDone()

  # ── 4. A consulta atualizou de verdade? Se o ERP estiver fora do ar,
  #       o Excel mantém os dados velhos sem avisar — e mandar isso
  #       como foto nova seria pior do que não mandar nada.
  $datas = @()
  foreach ($c in $conexoes) {
    $d = $null
    try { $d = $c.OLEDBConnection.RefreshDate } catch {}
    if (-not $d) { try { $d = $c.ODBCConnection.RefreshDate } catch {} }
    if ($d) { $datas += [datetime]$d }
  }
  if ($datas.Count -gt 0) {
    $maisNova = $datas | Sort-Object | Select-Object -Last 1
    if ($maisNova -lt $inicio.AddMinutes(-1)) {
      throw "A consulta não atualizou (última atualização: $maisNova). Nada foi enviado."
    }
  } else {
    Anotar 'Aviso: não deu para ler a data da consulta; seguindo mesmo assim.'
  }
  $livro.Save()

  $dados = $folha.UsedRange.Value2
  $nLin = $dados.GetUpperBound(0)
  $nCol = $dados.GetUpperBound(1)

  $col = @{}
  for ($j = 1; $j -le $nCol; $j++) {
    $chaveCol = Sem-Acento $dados[1, $j]
    if ($Mapa.ContainsKey($chaveCol)) { $col[$Mapa[$chaveCol]] = $j }
  }
  foreach ($f in $Obrigatorias) {
    if (-not $col.ContainsKey($f)) { throw "Coluna $f não encontrada na aba '$($folha.Name)'." }
  }
  if (-not $col.ContainsKey('DT_VALIDADE')) { Anotar "Aviso: a aba não tem 'data de validade' — o saldo vai sem as datas do lote." }

  # Lote sem saldo e sem empenho não vai: a SB8 guarda todo lote que já
  # existiu (dezenas de milhares de linhas zeradas).
  function Numero($v) {
    if ($v -is [double]) { return $v }
    $t = "$v".Trim() -replace '\s', ''
    if ($t -match ',\d+$') { $t = $t -replace '\.', '' -replace ',', '.' }
    $n = 0.0
    if ([double]::TryParse($t, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$n)) { return $n }
    return 0.0
  }
  $cSaldo = $col['B8_SALDO']; $cEmp = $col['B8_EMPENHO']; $cFil = $col['B8_FILIAL']; $cTipo = $col['B1_TIPO']
  $zerados = 0; $outras = 0; $outrosTipos = 0
  $linhas = New-Object System.Collections.Generic.List[object]
  for ($i = 2; $i -le $nLin; $i++) {
    if ((Numero $dados[$i, $cSaldo]) -eq 0 -and (-not $cEmp -or (Numero $dados[$i, $cEmp]) -eq 0)) { $zerados++; continue }
    if ($Filiais.Count -and $cFil) {
      $f = $dados[$i, $cFil]
      $f = if ($f -is [double]) { ([int64]$f).ToString() } else { "$f".Trim() }
      if ($f -match '^\d{1,5}$') { $f = $f.PadLeft(6, '0') }
      if ($Filiais -notcontains $f) { $outras++; continue }
    }
    if ($Tipos.Count -and $cTipo) {
      if ($Tipos -notcontains "$($dados[$i, $cTipo])".Trim().ToUpper()) { $outrosTipos++; continue }
    }
    $o = [ordered]@{}
    foreach ($k in $col.Keys) {
      $v = $dados[$i, $col[$k]]
      # Célula com erro (#DIV/0!, #N/D) chega como Int32: vai vazia.
      if ($v -is [int]) { $v = $null }
      elseif ($v -is [string]) { $v = $v.Trim() }
      # Código, lote, filial e armazém são texto: célula numérica viraria
      # 12007000091.0 no envio.
      # (Datas ficam número: o Supabase converte o número de série do Excel.)
      elseif ($v -is [double] -and $k -notin 'B8_SALDO','B8_EMPENHO','PALETES','CXS' -and $k -notlike 'DT_*' -and $v -eq [math]::Truncate($v)) {
        $v = ([int64]$v).ToString()
      }
      $o[$k] = $v
    }
    if ("$($o['B8_PRODUTO'])" -ne '') { $linhas.Add([pscustomobject]$o) }
  }
  if ($linhas.Count -eq 0) { throw "A aba '$($folha.Name)' está vazia depois de atualizar. Nada foi enviado." }

  # ── 5. Envia. O Supabase troca a foto numa transação só: se der erro,
  #       a foto anterior continua lá.
  $corpo = ConvertTo-Json -Compress -Depth 4 -InputObject @{
    linhas = $linhas.ToArray()
    origem = "robô Excel ($env:COMPUTERNAME)"
  }
  $r = Chamar-Supabase "$Supabase/rest/v1/rpc/importar_estoque_ref" $chave ([Text.Encoding]::UTF8.GetBytes($corpo))
  if ($r.status -lt 200 -or $r.status -ge 300) { throw "Supabase respondeu $($r.status): $($r.corpo)" }
  $resp = $r.corpo | ConvertFrom-Json

  Anotar "OK: $($resp.linhas) linha(s) enviada(s) (ficaram fora: $zerados zerada(s), $outras de outras filiais, $outrosTipos de outros tipos) · filiais $($resp.filiais -join ', ') · $([int]((Get-Date) - $inicio).TotalSeconds)s"
  Fim-Robo 'ok' "$($resp.linhas) linhas"
}
catch {
  $msg = $_.Exception.Message
  # Erro do Supabase vem no corpo da resposta; é ele que explica o que houve.
  if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $msg += " · " + $_.ErrorDetails.Message }
  Anotar "ERRO: $msg"
  Fim-Robo 'erro' $msg
  $falhou = $true
}
finally {
  if ($livro) { try { $livro.Close($false) } catch {} }
  if ($excel) {
    try { $excel.Quit() } catch {}
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
  }
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
  # O Excel escondido às vezes não fecha com o Quit: fecha à força.
  if ($pidExcel) {
    Start-Sleep -Seconds 3
    Stop-Process -Id $pidExcel -Force -ErrorAction SilentlyContinue
  }
  Remove-Item $ArqPid -Force -ErrorAction SilentlyContinue
}

if ($falhou) { exit 1 }
