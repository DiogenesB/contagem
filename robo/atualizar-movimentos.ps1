# ═══════════════════════════════════════════════════════════════
#  ROBÔ DAS MOVIMENTAÇÕES · planilha Mov. Estoque (MOVEST01) → Supabase
#
#  1. Abre a planilha num Excel escondido
#  2. Põe nas células De/Até a janela dos últimos dias
#  3. Atualiza SÓ a consulta das movimentações
#  4. Manda para o Supabase só as filiais e os tipos configurados
#     (a função troca a janela inteira: estorno no ERP some daqui também)
#  5. Salva a cópia (só com a janela), fecha e anota no log
#
#  Quem chama: Agendador do Windows, às 07:00, às 12:00 e quando o
#  usuário entra no Windows (se o PC estava desligado às 07:00).
#  Na mão: RODAR-MOVIMENTOS.bat (ou este script com -Dias 60).
# ═══════════════════════════════════════════════════════════════

param([int]$Dias = 0)   # 0 = o padrão abaixo (na primeira vez, a carga inicial)

# ─────────────── CONFIGURE AQUI ───────────────
$Planilha     = 'C:\RoboSaldo\planilha-mov.xlsx'   # cópia só do robô
$Aba          = 'Movest01'                          # aba com a tabela da consulta
$Supabase     = 'https://yuaboypybjqxxgntfyrq.supabase.co'
$ArqChave     = 'C:\RoboSaldo\chave-supabase.txt'
$Log          = 'C:\RoboSaldo\atualizar-movimentos.log'
$Filiais      = @('010001', '020006', '090010')
$Tipos        = @('PA', 'ME')
$DiasPadrao   = 3      # janela de cada rodada (pega lançamento atrasado e estorno)
$DiasInicial  = 60     # primeira vez: histórico
# ──────────────────────────────────────────────

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Pasta  = Split-Path -Parent $Log
$ArqPid = Join-Path $Pasta 'excel-mov.pid'
$ArqIni = Join-Path $Pasta 'movimentos-carga-inicial.ok'

function Anotar($msg) {
  $msg = ("$msg" -replace '\s*[\r\n]+\s*', ' ').Trim()
  try { if ((Test-Path $Log) -and (Get-Item $Log).Length -gt 2MB) { Move-Item $Log "$Log.antigo" -Force } } catch {}
  "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg" | Add-Content -Path $Log -Encoding UTF8
}

function Chamar-Supabase($url, $chave, [byte[]]$corpo) {
  $req = [Net.HttpWebRequest]::Create($url)
  $req.Method = 'POST'
  $req.ContentType = 'application/json; charset=utf-8'
  $req.Timeout = 300000
  $req.ReadWriteTimeout = 300000
  $req.Headers['apikey'] = $chave
  if ($chave.StartsWith('eyJ')) { $req.Headers['Authorization'] = "Bearer $chave" }
  $s = $req.GetRequestStream(); $s.Write($corpo, 0, $corpo.Length); $s.Close()
  $resp = $null
  try { $resp = $req.GetResponse() }
  catch {
    $we = $_.Exception
    while ($we -and -not ($we -is [Net.WebException])) { $we = $we.InnerException }
    if (-not $we -or -not $we.Response) { throw }
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

# Cabeçalho da planilha (sem acento, minúsculo) → nome no envio.
# CPF/CNPJ e endereço do cliente ficam de fora: o sistema não precisa.
$Mapa = @{
  'filial'='FILIAL'; 'sequencia'='SEQ'; 'tipo movimento'='TIPO_MOV'; 'tipo de produto'='TIPO_PROD'
  'codigo produto'='COD'; 'descricao produto'='DESC'; 'quantidade'='QTD'; 'um'='UM'; 'lote'='LOTE'
  'data de validade'='VALIDADE'; 'armazem'='ARM'; 'volumes'='VOL'; 'pallets'='PAL'; 'valor total'='VALOR'
  'cod. cli/forn'='CLI_COD'; 'loja cli/forn'='CLI_LOJA'; 'nome cli/forn'='CLI_NOME'; 'estado cli/forn'='CLI_UF'
  'num. nf-e'='NF'; 'serie nf'='SERIE'; 'tipo nf-e'='TIPO_NF'; 'data emissao'='EMISSAO'; 'centro de custo'='CC'
  'class. fiscal'='CFOP'; 'num. tes'='TES'; 'desc tes'='TES_DESC'; 'usuario mov.'='USUARIO'
  'controla estoque?'='MOVEST'; 'dx_numsa'='NUMSA'; 'num. pedido/sa/st'='PEDIDO'; 'usuario_import'='USU_IMPORT'
}
$Obrigatorias = 'FILIAL','TIPO_MOV','COD','QTD','LOTE','ARM','EMISSAO'

# A pasta do robô como "local confiável" do Excel: sem isso, uma planilha
# que nunca foi aberta à mão fica com as conexões externas bloqueadas
# ("Habilitar conteúdo") e a atualização falha com 0x800A03EC.
function Confiar-Pasta($pasta) {
  $p = $pasta.TrimEnd('\') + '\'
  $vers = @(Get-ChildItem 'HKCU:\Software\Microsoft\Office' -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -match '^\d+\.\d+$' } | ForEach-Object { $_.PSChildName })
  if (-not $vers.Count) { $vers = @('16.0') }
  foreach ($v in $vers) {
    $k = "HKCU:\Software\Microsoft\Office\$v\Excel\Security\Trusted Locations\RoboSaldo"
    try {
      New-Item -Path $k -Force | Out-Null
      New-ItemProperty -Path $k -Name 'Path' -Value $p -PropertyType String -Force | Out-Null
      New-ItemProperty -Path $k -Name 'AllowSubfolders' -Value 1 -PropertyType DWord -Force | Out-Null
      New-ItemProperty -Path $k -Name 'Description' -Value 'Robô do saldo e das movimentações' -PropertyType String -Force | Out-Null
    } catch {}
  }
}

Add-Type -Namespace RoboMov -Name Janela -MemberDefinition '[DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(System.IntPtr hWnd, out int pid);' -ErrorAction SilentlyContinue

$excel = $null; $livro = $null; $pidExcel = 0; $falhou = $false; $etapa = 'início' 
$inicio = Get-Date

try {
  if ($Dias -le 0) { $Dias = if (Test-Path $ArqIni) { $DiasPadrao } else { $DiasInicial } }
  $ate = (Get-Date).Date
  $de  = $ate.AddDays(-($Dias - 1))
  Anotar "Início (janela $($de.ToString('dd/MM/yyyy')) a $($ate.ToString('dd/MM/yyyy')))"
  if (-not (Test-Path $Planilha)) { throw "Planilha não encontrada: $Planilha" }
  if (-not (Test-Path $ArqChave)) { throw "Arquivo da chave não encontrado: $ArqChave" }
  $chave = (Get-Content $ArqChave -Raw).Trim()

  # Excel do robô que ficou travado na vez anterior: fecha (só o mesmo processo).
  if (Test-Path $ArqPid) {
    $velho = $null
    try { $velho = Get-Process -Id ([int](Get-Content $ArqPid -Raw).Trim()) -ErrorAction Stop } catch {}
    if ($velho -and $velho.ProcessName -eq 'EXCEL' -and $velho.StartTime -le (Get-Item $ArqPid).LastWriteTime) {
      Stop-Process -Id $velho.Id -Force
      Anotar 'Aviso: fechei o Excel do robô que tinha ficado travado na execução anterior.'
      Start-Sleep -Seconds 2
    }
    Remove-Item $ArqPid -Force -ErrorAction SilentlyContinue
  }

  $etapa = 'abrir a planilha'
  Confiar-Pasta $Pasta
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false; $excel.DisplayAlerts = $false; $excel.AskToUpdateLinks = $false
  try { [void][RoboMov.Janela]::GetWindowThreadProcessId([IntPtr]$excel.Hwnd, [ref]$pidExcel); Set-Content $ArqPid $pidExcel } catch {}
  $livro = $excel.Workbooks.Open($Planilha)
  # A consulta junta a célula de data (planilha) com o ERP (ODBC): sem isto o
  # Power Query pede "nível de privacidade para cada fonte" e não atualiza.
  try { $livro.Queries.FastCombine = $true } catch {}

  $etapa = 'achar a tabela'
  # ── Aba e tabela da consulta ──
  $folha = $null
  foreach ($w in $livro.Worksheets) { if ($w.Name -eq $Aba) { $folha = $w } }
  if (-not $folha) {
    foreach ($w in $livro.Worksheets) {
      foreach ($lo in $w.ListObjects) {
        $cab = @($lo.HeaderRowRange.Value2) | ForEach-Object { Sem-Acento $_ }
        if ($cab -contains 'tipo movimento') { $folha = $w; break }
      }
      if ($folha) { break }
    }
    if (-not $folha) { throw "Nenhuma aba com a tabela das movimentações (coluna 'Tipo Movimento')." }
    Anotar "Aviso: a aba '$Aba' não existe; usei a aba '$($folha.Name)'."
  }
  $tabela = $null
  foreach ($lo in $folha.ListObjects) { $tabela = $lo; break }
  if (-not $tabela) { throw "A aba '$($folha.Name)' não tem a tabela da consulta." }

  # ── Datas De/Até: as células que a consulta lê (nomes de_emiss/ate_emiss).
  #    Elas são =TEXTO(D3;"AAAAMMDD"): o robô escreve a data na célula de
  #    origem (D3/D4). Sem fórmula, escreve o texto AAAAMMDD direto.
  function Por-Data($nome, [datetime]$d) {
    $alvo = $null
    try { $alvo = $livro.Names.Item($nome).RefersToRange } catch {}
    if (-not $alvo) { throw "A planilha não tem o nome '$nome' (célula da data da consulta)." }
    if ($alvo.HasFormula) {
      $origem = $null
      try { $origem = $alvo.DirectPrecedents.Cells.Item(1) } catch {}
      if (-not $origem) { throw "Não achei a célula de data que alimenta '$nome'." }
      $origem.Value2 = $d.ToOADate()
    } else {
      $alvo.NumberFormat = '@'
      $alvo.Value2 = $d.ToString('yyyyMMdd')
    }
  }
  $etapa = 'pôr as datas De/Até'
  Por-Data 'de_emiss'  $de
  Por-Data 'ate_emiss' $ate
  $excel.Calculate()

  $etapa = 'atualizar a consulta'
  # ── Atualiza só a consulta da tabela ──
  $con = $null
  try { $con = $tabela.QueryTable.WorkbookConnection } catch {}
  if (-not $con) { foreach ($c in $livro.Connections) { if ($c.Name -like '*Movest*' -or $c.Name -like "*$($folha.Name)*") { $con = $c } } }
  if (-not $con) { throw 'Não achei a consulta das movimentações na planilha.' }
  try { $con.OLEDBConnection.BackgroundQuery = $false } catch {}
  try { $con.ODBCConnection.BackgroundQuery  = $false } catch {}
  $t0 = Get-Date
  try { $con.Refresh() }
  catch {
    # Segunda tentativa pela tabela (algumas versões do Excel só aceitam assim).
    try { $tabela.QueryTable.Refresh($false) | Out-Null }
    catch { throw "o Excel recusou atualizar a consulta ($($_.Exception.Message)). Abra C:\RoboSaldo\planilha-mov.xlsx, clique em Habilitar Conteúdo se aparecer, Dados > Atualizar Tudo e veja a mensagem do Excel" }
  }
  $excel.CalculateUntilAsyncQueriesDone()
  $quando = $null
  try { $quando = $con.OLEDBConnection.RefreshDate } catch {}
  if ($quando -and ([datetime]$quando) -lt $inicio.AddMinutes(-1)) { throw "A consulta não atualizou (última atualização: $quando). Nada foi enviado." }
  Anotar "Consulta '$($con.Name)' atualizada em $([int]((Get-Date) - $t0).TotalSeconds)s"

  $etapa = 'ler a tabela'
  # ── Lê a tabela ──
  $linhas = New-Object System.Collections.Generic.List[object]
  $outras = 0; $outrosTipos = 0
  $n = $tabela.ListRows.Count
  if ($n -gt 0) {
    $dados = $tabela.Range.Value2
    $nLin = $dados.GetUpperBound(0); $nCol = $dados.GetUpperBound(1)
    $col = @{}
    for ($j = 1; $j -le $nCol; $j++) { $k = Sem-Acento $dados[1, $j]; if ($Mapa.ContainsKey($k)) { $col[$Mapa[$k]] = $j } }
    foreach ($f in $Obrigatorias) { if (-not $col.ContainsKey($f)) { throw "Coluna $f não encontrada na tabela das movimentações." } }
    for ($i = 2; $i -le $nLin; $i++) {
      $fil = $dados[$i, $col['FILIAL']]
      $fil = if ($fil -is [double]) { ([int64]$fil).ToString() } else { "$fil".Trim() }
      if ($fil -match '^\d{1,5}$') { $fil = $fil.PadLeft(6, '0') }
      if ($Filiais.Count -and $Filiais -notcontains $fil) { $outras++; continue }
      if ($Tipos.Count -and $col['TIPO_PROD'] -and ($Tipos -notcontains "$($dados[$i, $col['TIPO_PROD']])".Trim().ToUpper())) { $outrosTipos++; continue }
      $o = [ordered]@{}
      foreach ($k in $col.Keys) {
        $v = $dados[$i, $col[$k]]
        if ($v -is [int]) { $v = $null }                      # célula com erro
        elseif ($v -is [string]) { $v = $v.Trim() }
        $o[$k] = $v
      }
      $o['FILIAL'] = $fil
      $linhas.Add([pscustomobject]$o)
    }
  }

  # Salva a cópia do robô já só com a janela: a próxima abertura fica rápida
  # (a planilha original pode ter o ano inteiro, centenas de milhares de linhas).
  try { $livro.Save() } catch { Anotar "Aviso: não consegui salvar a cópia ($($_.Exception.Message))." }

  $etapa = 'enviar ao sistema'
  # ── Envia ──
  $corpo = ConvertTo-Json -Compress -Depth 4 -InputObject @{
    linhas = $linhas.ToArray(); p_de = $de.ToString('yyyy-MM-dd'); p_ate = $ate.ToString('yyyy-MM-dd')
    p_filiais = $Filiais; origem = "robô movimentações ($env:COMPUTERNAME)"
  }
  $r = Chamar-Supabase "$Supabase/rest/v1/rpc/importar_erp_mov" $chave ([Text.Encoding]::UTF8.GetBytes($corpo))
  if ($r.status -lt 200 -or $r.status -ge 300) { throw "Supabase respondeu $($r.status): $($r.corpo)" }
  $resp = $r.corpo | ConvertFrom-Json
  if (-not (Test-Path $ArqIni)) { Set-Content -Path $ArqIni -Value (Get-Date -Format s) }
  Anotar "OK: $($resp.linhas) movimento(s) de $($de.ToString('dd/MM')) a $($ate.ToString('dd/MM')) (ficaram fora: $outras de outras filiais, $outrosTipos de outros tipos) · $([int]((Get-Date) - $inicio).TotalSeconds)s"
}
catch {
  $msg = $_.Exception.Message
  if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $msg += ' · ' + $_.ErrorDetails.Message }
  Anotar "ERRO ao $($etapa): $msg"
  $falhou = $true
}
finally {
  if ($livro) { try { $livro.Close($false) } catch {} }
  if ($excel) { try { $excel.Quit() } catch {}; [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel) }
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
  if ($pidExcel) { Start-Sleep -Seconds 3; Stop-Process -Id $pidExcel -Force -ErrorAction SilentlyContinue }
  Remove-Item $ArqPid -Force -ErrorAction SilentlyContinue
}
if ($falhou) { exit 1 }
