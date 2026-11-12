# Simbiose · Controle de estoque

Sistema de contagem, mapa do drive-in e controle de estoque da Simbiose Agro.
Site estático (HTML + JavaScript, sem build) publicado na Vercel, com os dados no Supabase.

Endereço: https://contagem-chi.vercel.app

## As telas

| Endereço | Arquivo | Para quem |
|---|---|---|
| `/` ou `/painel.html` | `pages/painel.html` | Gestão: Hoje, saldo, mapa, analista, validação |
| `/mobile.html` | `pages/mobile.html` | Operador no celular: contagem e transferências |
| `/mapa.html` | `pages/mapa.html` | Mapa do drive-in: guardar, mover, expedir, separar |
| `/layout.html` | `pages/layout.html` | Pavilhão em 3D, armazém de cada linha, planta em PDF |

Os endereços continuam os mesmos de sempre: o `vercel.json` aponta cada um para o arquivo dentro de `pages/`.
As quatro telas são apps instaláveis (PWA), cada uma com seu ícone.

## Pastas

```
pages/                 as 4 telas
assets/
  js/
    comum/             usado por mais de uma tela
                       comum.js · usuarios.js · impressao.js · identificacao.js · leitor.js · pwa.js
    painel/            só do painel
                       painel-app.js · inicio.js · saldo-mapeado.js · saldo-erp.js · inteligencia.js · analista.js · boletim.js
    mapa/              só do mapa: separacao.js
    operador/          só do app do operador: fila.js
  icons/               ícones dos apps (painel-*, operador-*, mapa-*, layout-*)
  manifests/           um manifesto de app por tela (painel, operador, mapa, layout)
sql/                   migrações do Supabase (rodar no SQL Editor)
robo/                  robôs do PC (saldo SB8 e movimentações do ERP)
sw.js                  service worker (fica na raiz para valer para todas as telas)
vercel.json            endereços e cabeçalhos da Vercel
```

## Atualizar

- Mudou um `.js`: troque o número `?v=` onde ele é carregado na página (ex.: `inteligencia.js?v=5` → `?v=6`), para o celular buscar a versão nova.
- Mudou o `sw.js`: suba o número em `const CACHE = 'simbiose-vNN'`.
- Caminhos dentro das páginas são absolutos (`/assets/...`): funcionam em qualquer endereço.

## Banco (Supabase)

Rodar no SQL Editor, uma vez cada (todos podem rodar de novo sem estragar nada):
`migracao-usuarios`, `migracao-identificacao`, `migracao-saldo-mapeado`, `sync-saldo-erp`, `migracao-saldo-historico`,
`migracao-separacao`, `migracao-inteligencia`, `migracao-robo-pedido`, `migracao-movimentos`, `migracao-drive-armazem`.

## Robôs

Na pasta `robo/`, ver o `LEIA-ME.txt`. A chave secreta do Supabase fica só no PC do robô (`C:\RoboSaldo\chave-supabase.txt`), nunca neste repositório.
