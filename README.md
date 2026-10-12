# token-usage-sidebar

Barra lateral de desktop (Windows) que mostra o **consumo da sua conta do Claude** nas janelas de **5 horas** e **7 dias**. Fica ancorada à direita, recolhida como dois medidores circulares; ao passar o mouse, expande um painel com detalhes e um mini-gráfico de histórico. Acompanha um **painel de controle** e ícone na bandeja.

Feita em **Electron (Node.js)**, com visual próprio.

## Fontes de dados (híbrido)

O app tenta, nesta ordem:

1. **Ao vivo** — se existir o arquivo de credenciais **em texto puro** da CLI do Claude Code
   (`~/.claude/.credentials.json`, ou o diretório em `CLAUDE_CONFIG_DIR`), lê o token OAuth e
   consulta `GET https://api.anthropic.com/api/oauth/usage`
   (cabeçalhos `Authorization: Bearer <token>` e `anthropic-beta: oauth-2025-04-20`).
   Esses números batem com a página de **Uso** do Claude. O token é enviado **apenas** ao
   domínio oficial da Anthropic.
2. **Local** (reserva) — lê o histórico que o app de desktop do Claude mantém em
   `%APPDATA%\Claude\plan-usage-history.json`. Não exige token, porém é atualizado de forma
   esparsa, então pode defasar em relação à página ao vivo.

> O app **não** descriptografa cofres de credenciais. O modo ao vivo depende do arquivo
> `.credentials.json` em texto puro que a CLI do Claude Code gera no login.

## Recursos

- Medidores 5h/7d, painel de detalhes com histórico, e indicador de fonte (ao vivo/local).
- Painel de controle: status, mostrar/ocultar widget, iniciar com o Windows, frequência de atualização.
- Ícone na bandeja com menu.

## Desenvolvimento

```
npm install
npm start
```

## Gerar o executável

```
npm install
npm run dist
```

O `.exe` portátil é gerado em `dist/token-usage-sidebar.exe`.

## Créditos

Projeto independente, **sem vínculo com a Anthropic**. O mecanismo de leitura de uso ao vivo
foi reescrito de forma original, **inspirado** no projeto open source (MIT)
[CodeZeno/Claude-Code-Usage-Monitor](https://github.com/CodeZeno/Claude-Code-Usage-Monitor).

## Licença

[MIT](LICENSE)
