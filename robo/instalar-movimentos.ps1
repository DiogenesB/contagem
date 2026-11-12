# ═══════════════════════════════════════════════════════════════
#  INSTALADOR DO ROBÔ DAS MOVIMENTAÇÕES
#  Usa a pasta C:\RoboSaldo e a chave que o INSTALAR.bat (robô do
#  saldo) já deixou. Pede a planilha Mov. Estoque, testa, faz a carga
#  inicial (60 dias) e agenda às 07:00 e às 12:00.
#  Antes: rode o sql/migracao-movimentos.sql no Supabase.
#  Como usar: duplo clique no INSTALAR-MOVIMENTOS.bat (mesma pasta).
# ═══════════════════════════════════════════════════════════════

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Origem   = Split-Path -Parent $MyInvocation.MyCommand.Path
$Pasta    = 'C:\RoboSaldo'
$Supabase = 'https://yuaboypybjqxxgntfyrq.supabase.co'

function Titulo($t) { Write-Host ''; Write-Host "── $t " -ForegroundColor Cyan }
function Ok($t)     { Write-Host "   OK  $t" -ForegroundColor Green }
function Aviso($t)  { Write-Host "   !   $t" -ForegroundColor Yellow }
function Pergunta($t, $padrao) {
  $r = Read-Host "   $t [$padrao]"
  if ([string]::IsNullOrWhiteSpace($r)) { return $padrao } else { return $r.Trim() }
}
function Chamar-Supabase($url, $chave, [byte[]]$corpo) {
  $req = [Net.HttpWebRequest]::Create($url)
  $req.Method = 'POST'; $req.ContentType = 'application/json; charset=utf-8'; $req.Timeout = 120000
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

try {
  Write-Host ''
  Write-Host '  INSTALADOR DO ROBÔ DAS MOVIMENTAÇÕES (planilha Mov. Estoque -> sistema)' -ForegroundColor White
  Write-Host '  Antes de seguir, rode o sql/migracao-movimentos.sql no Supabase.' -ForegroundColor DarkGray

  # ── 1. Pasta e chave do robô do saldo ──
  Titulo '1/5  Pasta C:\RoboSaldo'
  $arqChave = Join-Path $Pasta 'chave-supabase.txt'
  if (-not (Test-Path $arqChave)) { throw 'Não achei C:\RoboSaldo\chave-supabase.txt. Instale primeiro o robô do saldo (INSTALAR.bat).' }
  $chave = (Get-Content $arqChave -Raw).Trim()
  $robo = Join-Path $Pasta 'atualizar-movimentos.ps1'
  Copy-Item (Join-Path $Origem 'atualizar-movimentos.ps1') $robo -Force
  Unblock-File $robo
  Ok "robô copiado para $robo (usa a mesma chave do robô do saldo)"

  # Mesmas filiais do robô do saldo.
  $roboSaldo = Join-Path $Pasta 'atualizar-saldo.ps1'
  $linhaFil = if (Test-Path $roboSaldo) { Get-Content $roboSaldo -Encoding UTF8 | Where-Object { $_ -like '$Filiais *' } | Select-Object -First 1 } else { $null }

  # ── 2. Planilha ──
  Titulo '2/5  Planilha Mov. Estoque'
  Write-Host '   Escolha na janela a planilha das movimentações (consulta MOVEST01).'
  Add-Type -AssemblyName System.Windows.Forms
  $dlg = New-Object System.Windows.Forms.OpenFileDialog
  $dlg.Title  = 'Planilha Mov. Estoque (MOVEST01)'
  $dlg.Filter = 'Planilhas do Excel (*.xlsx;*.xlsm;*.xls)|*.xlsx;*.xlsm;*.xls'
  if ($dlg.ShowDialog() -ne 'OK') { throw 'Nenhuma planilha escolhida.' }
  $planilha = Join-Path $Pasta ('planilha-mov' + [IO.Path]::GetExtension($dlg.FileName))
  Copy-Item $dlg.FileName $planilha -Force
  Ok "cópia da planilha em $planilha"
  Confiar-Pasta $Pasta
  Ok 'C:\RoboSaldo marcada como local confiável do Excel (as conexões da planilha não ficam bloqueadas)' 

  # ── 3. Confere no Excel: tabela com 'Tipo Movimento' e as datas de_emiss/ate_emiss ──
  Titulo '3/5  Conferindo a planilha no Excel'
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false; $excel.DisplayAlerts = $false
  $aba = $null; $temDatas = $false
  try {
    $livro = $excel.Workbooks.Open($planilha)
    foreach ($w in $livro.Worksheets) {
      foreach ($lo in $w.ListObjects) {
        $cab = @($lo.HeaderRowRange.Value2) | ForEach-Object { ("$_".Normalize([Text.NormalizationForm]::FormD) -replace '\p{Mn}', '').ToLower().Trim() }
        if ($cab -contains 'tipo movimento') { $aba = $w.Name }
      }
    }
    $nomes = @(); foreach ($n in $livro.Names) { $nomes += $n.Name }
    $temDatas = ($nomes -contains 'de_emiss') -and ($nomes -contains 'ate_emiss')
    $livro.Close($false)
  } finally { $excel.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel) }
  if (-not $aba) { throw "A planilha não tem a tabela das movimentações (coluna 'Tipo Movimento'). Escolheu o arquivo certo?" }
  if (-not $temDatas) { throw "A planilha não tem as células de data da consulta (nomes de_emiss e ate_emiss)." }
  Ok "aba das movimentações: '$aba' · datas De/Até encontradas"

  $linhasRobo = Get-Content $robo -Encoding UTF8 | ForEach-Object {
    if     ($_ -like '$Planilha *') { '$Planilha     = ''' + $planilha.Replace("'", "''") + '''   # cópia só do robô' }
    elseif ($_ -like '$Aba *')      { '$Aba          = ''' + $aba.Replace("'", "''") + '''   # aba com a tabela da consulta' }
    elseif ($_ -like '$Filiais *' -and $linhaFil) { $linhaFil }
    else { $_ }
  }
  [IO.File]::WriteAllLines($robo, [string[]]$linhasRobo, (New-Object Text.UTF8Encoding($true)))
  Ok 'robô configurado'

  # ── 4. Testa o banco (janela vazia em 1900: não mexe em nada) ──
  Titulo '4/5  Testando a conexão com o sistema'
  $corpo = '{"linhas":[],"p_de":"1900-01-01","p_ate":"1900-01-01","p_filiais":["teste"],"origem":"teste do instalador"}'
  $r = Chamar-Supabase "$Supabase/rest/v1/rpc/importar_erp_mov" $chave ([Text.Encoding]::UTF8.GetBytes($corpo))
  if ($r.status -ge 200 -and $r.status -lt 300) { Ok 'conexão ok' }
  elseif ($r.corpo -match 'PGRST202|Could not find|42883') { throw 'O banco ainda não tem a função: rode o sql/migracao-movimentos.sql no Supabase e rode este instalador de novo.' }
  else { throw "O Supabase respondeu $($r.status): $($r.corpo)" }

  Write-Host '   Carga inicial: os últimos 60 dias (pode levar alguns minutos)...'
  $arqLog = Join-Path $Pasta 'atualizar-movimentos.log'
  $antes = if (Test-Path $arqLog) { @(Get-Content $arqLog -Encoding UTF8).Count } else { 0 }
  # A carga inicial (60 dias) só na primeira instalação; depois, a janela normal.
  if (Test-Path (Join-Path $Pasta 'movimentos-carga-inicial.ok')) { Write-Host '   (já tem histórico: só os últimos dias)' }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $robo
  $novas = if (Test-Path $arqLog) { @(Get-Content $arqLog -Encoding UTF8 | Select-Object -Skip $antes | Where-Object { "$_".Trim() }) } else { @() }
  $ult = $novas | Select-Object -Last 1
  if ($ult -match 'OK:') { Ok $ult }
  else {
    Aviso 'a carga inicial não deu certo. O que o robô anotou:'
    if ($novas.Count) { $novas | ForEach-Object { Write-Host "       $_" -ForegroundColor Yellow } }
    Aviso 'mande essas linhas para quem cuida do sistema, corrija e rode o instalador de novo.'
  }

  # ── 5. Agendamento: 07:00 e 12:00 ──
  Titulo '5/5  Agendamento no Windows'
  $h1 = Pergunta 'Primeiro horário (HH:MM)' '07:00'
  $h2 = Pergunta 'Segundo horário (HH:MM)' '12:00'
  $vbs = Join-Path $Pasta 'rodar-mov-oculto.vbs'
  $vb = 'CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File ""' + $robo + '""", 0, True'
  [IO.File]::WriteAllText($vbs, $vb, [Text.Encoding]::ASCII)
  $acao = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbs`""
  # Mais um gatilho: ao entrar no Windows (o PC desligado às 07:00 não deixa o dia sem movimentos).
  $logon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
  $logon.Delay = 'PT3M'
  $gats = @((New-ScheduledTaskTrigger -Daily -At $h1), (New-ScheduledTaskTrigger -Daily -At $h2), $logon)
  $conf = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
            -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 40) -StartWhenAvailable
  $quem = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName 'Robô das movimentações' -Action $acao -Trigger $gats -Settings $conf -Principal $quem `
    -Description 'Manda as movimentações do ERP (Mov. Estoque) para o sistema (C:\RoboSaldo).' -Force | Out-Null
  $info = Get-ScheduledTaskInfo -TaskName 'Robô das movimentações'
  Ok "agendado: todo dia às $h1, às $h2 e 3 min depois de entrar no Windows · próxima: $($info.NextRunTime)"

  $rodar = Join-Path $Pasta 'RODAR-MOVIMENTOS.bat'
  "@echo off`r`nchcp 65001 >nul`r`necho Atualizando as movimentacoes... (pode levar alguns minutos)`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"$robo`"`r`necho.`r`npowershell -NoProfile -Command `"Get-Content '$Pasta\atualizar-movimentos.log' -Encoding UTF8 -Tail 4`"`r`npause" |
    Set-Content -Path $rodar -Encoding ASCII
  Ok "atalho para rodar na hora: $rodar"

  Write-Host ''
  Write-Host '  PRONTO. As movimentações chegam às 07:00 e às 12:00 (tela Analista e tela Hoje).' -ForegroundColor Green
  Write-Host "  Log: $Pasta\atualizar-movimentos.log" -ForegroundColor DarkGray
}
catch {
  Write-Host ''
  Write-Host "  PAROU: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host '  Corrija e rode o INSTALAR-MOVIMENTOS.bat de novo (pode repetir quantas vezes quiser).' -ForegroundColor DarkGray
}
