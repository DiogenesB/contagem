# ═══════════════════════════════════════════════════════════════
#  INSTALADOR DO ROBÔ DO SALDO
#  Faz sozinho os passos 3 a 7 do LEIA-ME:
#    cria C:\RoboSaldo, copia o robô, copia a planilha, guarda a chave,
#    acha a aba do saldo, testa a conexão, roda uma vez e agenda.
#  Antes: rode o sql/sync-saldo-erp.sql no Supabase (passo 1).
#  Como usar: duplo clique no INSTALAR.bat (na mesma pasta).
# ═══════════════════════════════════════════════════════════════

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Origem   = Split-Path -Parent $MyInvocation.MyCommand.Path
$Pasta    = 'C:\RoboSaldo'
$Supabase = 'https://yuaboypybjqxxgntfyrq.supabase.co'

function Titulo($t) { Write-Host ''; Write-Host "── $t " -ForegroundColor Cyan }
function Ok($t)     { Write-Host "   OK  $t" -ForegroundColor Green }
function Aviso($t)  { Write-Host "   !   $t" -ForegroundColor Yellow }
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

function Pergunta($t, $padrao) {
  $r = Read-Host "   $t [$padrao]"
  if ([string]::IsNullOrWhiteSpace($r)) { return $padrao } else { return $r.Trim() }
}

try {
  Write-Host ''
  Write-Host '  INSTALADOR DO ROBÔ DO SALDO (planilha do ERP -> Saldo mapeado)' -ForegroundColor White
  Write-Host '  Antes de seguir, rode no Supabase: sql/sync-saldo-erp.sql e sql/migracao-robo-pedido.sql.' -ForegroundColor DarkGray

  # ── 1. Pasta e robô ─────────────────────────────────────────────
  Titulo '1/7  Pasta C:\RoboSaldo'
  New-Item -ItemType Directory -Force -Path $Pasta | Out-Null
  $robo = Join-Path $Pasta 'atualizar-saldo.ps1'
  Copy-Item (Join-Path $Origem 'atualizar-saldo.ps1') $robo -Force
  Copy-Item (Join-Path $Origem 'LEIA-ME.txt') (Join-Path $Pasta 'LEIA-ME.txt') -Force -ErrorAction SilentlyContinue
  Unblock-File $robo
  Ok "robô copiado para $robo"

  # ── 2. Planilha ─────────────────────────────────────────────────
  Titulo '2/7  Planilha do ERP'
  Write-Host '   Escolha na janela a planilha que puxa o saldo do ERP.'
  Add-Type -AssemblyName System.Windows.Forms
  $dlg = New-Object System.Windows.Forms.OpenFileDialog
  $dlg.Title  = 'Planilha do ERP com o saldo por lote'
  $dlg.Filter = 'Planilhas do Excel (*.xlsx;*.xlsm;*.xls)|*.xlsx;*.xlsm;*.xls'
  if ($dlg.ShowDialog() -ne 'OK') { throw 'Nenhuma planilha escolhida.' }
  $original = $dlg.FileName
  # Uma cópia só do robô: ele salva depois de atualizar, e ninguém pode
  # estar com ela aberta nessa hora.
  $planilha = Join-Path $Pasta ('planilha-robo' + [IO.Path]::GetExtension($original))
  Copy-Item $original $planilha -Force
  Ok "cópia da planilha em $planilha"

  # ── 3. Aba do saldo (abre no Excel escondido e procura B8_PRODUTO) ──
  Titulo '3/7  Conferindo a planilha no Excel'
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false; $excel.DisplayAlerts = $false
  $aba = $null; $faltam = @(); $resumo = @()
  $todas = 'b8_filial','b1_tipo','b8_produto','b1_desc','b1_um','b8_lotectl','b8_saldo','b8_empenho','b8_local','data de fabricacao','data de validade'
  $obrigs = 'b8_produto','b8_lotectl','b8_saldo','b8_local'
  try {
    $livro = $excel.Workbooks.Open($planilha)
    # Olha a linha 1 de TODAS as abas e fica com a que tem mais colunas do
    # saldo (uma aba de cadastro também pode ter B8_PRODUTO).
    $melhor = -1
    foreach ($w in $livro.Worksheets) {
      $cab = @(); $n = [Math]::Min($w.UsedRange.Columns.Count + $w.UsedRange.Column, 200)
      for ($j = 1; $j -le $n; $j++) {
        $t = "$($w.Cells.Item(1, $j).Text)"
        if ($t) { $cab += ($t.Normalize([Text.NormalizationForm]::FormD) -replace '\p{Mn}', '').ToLower().Trim() }
      }
      $tem = @($todas | Where-Object { $cab -contains $_ })
      $temObrig = @($obrigs | Where-Object { $cab -contains $_ })
      $resumo += "      aba '$($w.Name)': $($tem.Count) de $($todas.Count) colunas do saldo"
      $nota = $temObrig.Count * 100 + $tem.Count
      if ($nota -gt $melhor -and $tem.Count -gt 0) { $melhor = $nota; $aba = $w.Name; $faltam = @($todas | Where-Object { $cab -notcontains $_ }); $cabMelhor = $cab }
    }
    $livro.Close($false)
  } finally {
    $excel.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
  }
  $resumo | ForEach-Object { Write-Host $_ -ForegroundColor DarkGray }
  if (-not $aba) { throw 'Nenhuma aba da planilha tem as colunas do saldo (B8_PRODUTO, B8_LOTECTL, B8_SALDO, B8_LOCAL) na linha 1.' }
  Ok "aba do saldo: '$aba'"
  $obrig = $faltam | Where-Object { $_ -in $obrigs }
  if ($obrig) {
    Write-Host "      linha 1 da aba '$aba': $(($cabMelhor | Select-Object -First 20) -join ' | ')" -ForegroundColor DarkGray
    throw "Na aba '$aba' faltam colunas obrigatórias na linha 1: $($obrig -join ', '). Confira se escolheu a planilha do saldo por LOTE (SB8)."
  }
  if ($faltam) { Aviso "colunas que não estão na planilha (o resto funciona): $($faltam -join ', ')" }

  # Grava caminho e aba no robô.
  $linhasRobo = Get-Content $robo -Encoding UTF8
  $linhasRobo = $linhasRobo | ForEach-Object {
    if     ($_ -like '$Planilha *') { '$Planilha = ''' + $planilha.Replace("'", "''") + '''   # caminho da planilha (cópia do robô)' }
    elseif ($_ -like '$Aba *')      { '$Aba      = ''' + $aba.Replace("'", "''") + '''   # nome da aba com o saldo por lote' }
    else { $_ }
  }
  [IO.File]::WriteAllLines($robo, [string[]]$linhasRobo, (New-Object Text.UTF8Encoding($true)))
  Ok 'robô configurado'

  # ── 4. Chave secreta ────────────────────────────────────────────
  Titulo '4/7  Chave secreta do Supabase'
  Write-Host '   Supabase > Project Settings > API Keys > Secret keys > copie a sb_secret_...'
  Write-Host '   Cole aqui (não aparece na tela) e aperte Enter:'
  $seg = Read-Host -AsSecureString '   chave'
  $chave = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($seg)).Trim()
  if (-not ($chave.StartsWith('sb_secret_') -or $chave.StartsWith('eyJ'))) { throw 'Essa não é a chave secreta (tem que começar com sb_secret_).' }
  $arqChave = Join-Path $Pasta 'chave-supabase.txt'
  [IO.File]::WriteAllText($arqChave, $chave)
  # Só o seu usuário consegue ler a chave.
  icacls $arqChave /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
  Ok 'chave guardada (só o seu usuário lê)'

  # ── 5. Conexão: manda uma lista vazia, que o banco recusa de propósito ──
  Titulo '5/7  Testando a conexão com o sistema'
  $r = Chamar-Supabase "$Supabase/rest/v1/rpc/importar_estoque_ref" $chave ([Text.Encoding]::UTF8.GetBytes('{"linhas":[]}'))
  $m = "$($r.status) $($r.corpo)"
  # A função recusa lista vazia de propósito: essa recusa prova que a
  # chave entrou e que a função existe, sem apagar nada.
  if ($m -match 'nenhuma linha recebida') { Ok 'conexão ok (chave e função do banco certas)' }
  elseif ($r.status -ge 200 -and $r.status -lt 300) { Ok 'conexão ok' }
  elseif ($m -match 'Could not find the function|PGRST202') { throw 'O banco ainda não tem a função: rode o sql/sync-saldo-erp.sql no Supabase e rode este instalador de novo.' }
  elseif ($m -match 'permission denied|42501') { throw 'Essa chave não tem permissão. Use a secret (sb_secret_...) ou a service_role — a anon/publishable não serve.' }
  elseif ($r.status -in 401, 403 -or $m -match 'Invalid API key|JWT') { throw "Chave recusada pelo Supabase. Confira se copiou a chave inteira. ($m)" }
  else { throw "O Supabase respondeu $m" }

  # ── 6. Primeira execução de verdade ─────────────────────────────
  Titulo '6/7  Rodando o robô uma vez (pode levar 1 minuto)'
  $arqLog = Join-Path $Pasta 'atualizar-saldo.log'
  $antes = if (Test-Path $arqLog) { @(Get-Content $arqLog -Encoding UTF8).Count } else { 0 }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $robo -Agora
  $codigo = $LASTEXITCODE
  # Só o que esta execução escreveu, sem linhas vazias.
  $novas = if (Test-Path $arqLog) { @(Get-Content $arqLog -Encoding UTF8 | Select-Object -Skip $antes | Where-Object { "$_".Trim() }) } else { @() }
  $ult = $novas | Select-Object -Last 1
  if ($ult -match 'OK:') { Ok $ult }
  else {
    Aviso "a primeira execução não deu certo (código de saída $codigo). O que o robô anotou:"
    if ($novas.Count) { $novas | ForEach-Object { Write-Host "       $_" -ForegroundColor Yellow } }
    else { Write-Host "       (nada no log $arqLog — o robô parou antes de começar)" -ForegroundColor Yellow }
    Aviso 'mande essas linhas para quem cuida do sistema, corrija e rode o instalador de novo.'
  }

  # ── 7. Agendamento ──────────────────────────────────────────────
  # O Windows acorda o robô a cada 5 min; é o robô quem pergunta ao Supabase
  # se é a vez dele (intervalo passou ou alguém pediu pelo painel).
  Titulo '7/7  Agendamento no Windows'
  $cada = [int](Pergunta 'Atualizar sozinho de quantos em quantos minutos' '60')
  $hIni = [int](Pergunta 'A partir de que hora (0-23)' '6')
  $hFim = [int](Pergunta 'Até que hora (0-23)' '19')
  if ($cada -lt 10 -or $hIni -lt 0 -or $hFim -gt 24 -or $hIni -ge $hFim) { throw "Horário inválido: a cada $cada min, das ${hIni}h às ${hFim}h. Use pelo menos 10 min e a hora de início menor que a de fim." }
  $linhasRobo = Get-Content $robo -Encoding UTF8 | ForEach-Object {
    if     ($_ -like '$IntervaloMin *') { "`$IntervaloMin = $cada" }
    elseif ($_ -like '$HoraIni *')      { "`$HoraIni      = $hIni" }
    elseif ($_ -like '$HoraFim *')      { "`$HoraFim      = $hFim" }
    else { $_ }
  }
  [IO.File]::WriteAllLines($robo, [string[]]$linhasRobo, (New-Object Text.UTF8Encoding($true)))

  # Lançador sem janela (powershell -WindowStyle Hidden ainda pisca a cada 5 min).
  # O True no fim faz o wscript ESPERAR o robô: assim o Agendador sabe que ele
  # ainda está rodando e não abre outro por cima.
  $vbs = Join-Path $Pasta 'rodar-oculto.vbs'
  $vb = 'CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File ""' + $robo + '""", 0, True'
  [IO.File]::WriteAllText($vbs, $vb, [Text.Encoding]::ASCII)

  $acao = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbs`""
  $gat  = New-ScheduledTaskTrigger -Daily -At '00:00'
  $rep  = New-ScheduledTaskTrigger -Once -At '00:00' -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 1)
  $gat.Repetition = $rep.Repetition
  # Sem "despertar o computador": com conferência a cada 5 min ele acordaria
  # o PC a noite toda. O PC do robô fica sem suspensão (pergunta abaixo).
  $conf = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
            -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 40) -StartWhenAvailable
  $quem = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName 'Robô do saldo' -Action $acao -Trigger $gat -Settings $conf -Principal $quem `
    -Description 'Confere a cada 5 min se é hora de atualizar o saldo do ERP (C:\RoboSaldo).' -Force | Out-Null
  Ok "agendado: confere a cada 5 min; atualiza a cada $cada min das ${hIni}h às ${hFim}h"
  try {
    Start-ScheduledTask -TaskName 'Robô do saldo'
    Start-Sleep -Seconds 3
    $info = Get-ScheduledTaskInfo -TaskName 'Robô do saldo'
    Ok "tarefa disparada agora para testar · próxima conferência: $($info.NextRunTime)"
  } catch { Aviso "a tarefa foi criada, mas não consegui disparar o teste: $($_.Exception.Message)" }

  # Atalho para rodar na hora, sem abrir o Agendador
  $rodar = Join-Path $Pasta 'RODAR-AGORA.bat'
  "@echo off`r`nchcp 65001 >nul`r`necho Atualizando o saldo... (pode levar alguns minutos)`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"$robo`" -Agora`r`necho.`r`npowershell -NoProfile -Command `"Get-Content '$Pasta\atualizar-saldo.log' -Encoding UTF8 -Tail 4`"`r`npause" |
    Set-Content -Path $rodar -Encoding ASCII
  Ok "atalho para rodar na hora: $rodar"

  $dormir = Pergunta 'Impedir que o computador entre em suspensão quando ligado na tomada? (s/n)' 's'
  if ($dormir -match '^[sS]') {
    try { powercfg /change standby-timeout-ac 0 | Out-Null; Ok 'suspensão na tomada desligada' }
    catch { Aviso 'não deu para mudar a energia (precisa de administrador): faça em Configurações > Sistema > Energia.' }
  }

  Write-Host ''
  Write-Host '  PRONTO. O Saldo vai se atualizar sozinho (e o botão "Pedir ao robô" do painel também funciona).' -ForegroundColor Green
  Write-Host "  Log de cada envio: $Pasta\atualizar-saldo.log" -ForegroundColor DarkGray
  Write-Host "  Para rodar na hora: $Pasta\RODAR-AGORA.bat (ou o botão Pedir ao robô no painel)." -ForegroundColor DarkGray
  Write-Host '  Para mudar o horário: rode este instalador de novo.' -ForegroundColor DarkGray
}
catch {
  Write-Host ''
  Write-Host "  PAROU: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host '  Corrija e rode o INSTALAR.bat de novo (pode repetir quantas vezes quiser).' -ForegroundColor DarkGray
}
