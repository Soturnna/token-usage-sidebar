# Token Usage Sidebar

![Plataforma](https://img.shields.io/badge/plataforma-Windows-0078D6)
![Electron](https://img.shields.io/badge/Electron-Node.js-47848F)
![Licença](https://img.shields.io/badge/licen%C3%A7a-MIT-3da639)

Barra lateral de desktop para **acompanhar o consumo da sua conta do Claude** em tempo real — as janelas de limite de **5 horas** (sessão) e **7 dias** (semanal), sem precisar abrir a página de uso.

Fica ancorada à borda direita da tela como dois medidores circulares. Ao passar o mouse, expande um painel translúcido (estilo *glassmorphism*) com as porcentagens, as barras de progresso, o tempo até a renovação e um resumo. Acompanha um **painel de controle** e um ícone na **bandeja do sistema**.

> Projeto **independente**, sem vínculo com a Anthropic. Feito em Electron (Node.js), com visual próprio.

---

## ✨ Recursos

- **Medidores 5h / 7d** sempre visíveis na lateral, com cores por intensidade.
- **Painel ao passar o mouse**: barras de progresso, tempo de renovação e resumo (pico semanal, dias ativos).
- **Modo ao vivo** que bate com a página de **Uso** do Claude.
- **Reserva local** quando o modo ao vivo não está disponível.
- **Arraste vertical**: segure a barra e deslize; a posição fica salva.
- **Painel de controle**: mostrar/ocultar o widget, **iniciar com o Windows**, frequência de atualização e verificação de novas versões.
- **Bandeja do sistema** com menu rápido (atualizar, frequência, mostrar/ocultar, sair).

## 🔄 Fontes de dados (híbrido)

O app tenta, nesta ordem:

1. **Ao vivo** — se existir o arquivo de credenciais **em texto puro** da CLI do Claude Code (`~/.claude/.credentials.json`, ou o diretório em `CLAUDE_CONFIG_DIR`), lê o token OAuth e consulta `GET https://api.anthropic.com/api/oauth/usage` (cabeçalhos `Authorization: Bearer <token>` e `anthropic-beta: oauth-2025-04-20`). Esses números batem com a página de **Uso**. O token é enviado **apenas** ao domínio oficial da Anthropic.
2. **Local** (reserva) — lê o histórico que o app de desktop do Claude mantém em `%APPDATA%\Claude\plan-usage-history.json`. Não exige token, porém é atualizado de forma esparsa, então pode defasar.

> ⚠️ O app **não descriptografa cofres de credenciais**. O modo ao vivo depende do arquivo `.credentials.json` em texto puro que a CLI do Claude Code gera no login.

## 📦 Instalação (uso)

1. Baixe o `.zip` mais recente em **[Releases](https://github.com/Soturnna/token-usage-sidebar/releases)**.
2. Extraia a pasta.
3. Execute **`token-usage-sidebar.exe`**.

Para o **modo ao vivo**, faça login pela CLI do Claude Code (gera o token em texto puro):

```powershell
claude   # e autentique-se; ou, dentro dele, use /login
```

## ⚙️ Configuração

| Variável / opção      | Função                                                        |
|-----------------------|---------------------------------------------------------------|
| `ANTHROPIC_MODEL`     | Modelo usado na sondagem de reserva (padrão: `claude-haiku-4-5`). |
| `CLAUDE_CONFIG_DIR`   | Diretório alternativo do `.credentials.json`.                 |
| Painel de controle    | Mostrar widget · Iniciar com o Windows · Frequência de atualização. |

## 🛠️ Desenvolvimento

```bash
npm install
npm start          # roda em modo de desenvolvimento
npm run dist       # empacota (electron-builder)
```

> O alvo portátil de **arquivo único** exige o *Modo de Desenvolvedor* do Windows (links simbólicos na etapa de assinatura). Sem ele, use `electron-builder --win dir`, que gera a pasta `dist/win-unpacked` funcional.

## 📁 Estrutura

```
src/
  main.js          processo principal: janelas, bandeja, config, IPC
  usage.js         leitura do histórico local (plan-usage-history.json)
  live.js          leitura ao vivo (token local + endpoint de uso)
  preload*.js       pontes seguras (contextBridge)
  make-icon.js     gera o ícone da bandeja
  renderer/        widget (index/renderer/styles) e painel de controle
```

## 🔒 Privacidade

- Nenhuma credencial é gravada no repositório; o token é lido **em tempo de execução**, na sua máquina.
- O token só é enviado ao domínio oficial `api.anthropic.com`.
- `node_modules/`, `dist/` e `.env` ficam fora do controle de versão.

## 🙏 Créditos

Mecanismo de leitura de uso ao vivo **reescrito de forma original**, inspirado no projeto open source (licença MIT) [CodeZeno/Claude-Code-Usage-Monitor](https://github.com/CodeZeno/Claude-Code-Usage-Monitor).

## 📄 Licença

[MIT](LICENSE) © 2026 Marcos Júnio
