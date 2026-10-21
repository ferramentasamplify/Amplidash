# Sala semanal — implementação preparada

Branch local: `feat/melhores-sala-login`.
Base: `main`, commit `784ec50`, conferida com `origin/main` em 21/10/2026.

## Entrega
- Login individual, identificação automática e sessão em cookie HttpOnly/SameSite/expiração de 12 horas.
- Senhas armazenadas como hashes scrypt; somente `alexandre-neto` recebe perfil administrativo.
- APIs de estado, pontuação, snapshots e reset agora exigem sessão administrativa no servidor.
- Painel existente carregado apenas após login administrativo, preservando gerenciamento, votação e rankings.
- Sala de espera, entrada, início pelo administrador e cronômetro de 5 minutos com destaque no minuto final.
- Zero não bloqueia escrita. Extensão de +1 ou +5 minutos disponível inclusive após zerar.
- Rascunhos privados com salvamento automático; envio “Terminei”; recuperação após recarregar.
- Apresentação sem cronômetro, com revelação e avanço manuais.
- Contas e salas usam um store privado separado. Não há migração, reset nem alteração dos pontos/metas atuais.
- Dados pessoais antigos foram removidos do seed público; o estado é lido da API autenticada sem reimportar caches antigos.

## Contas preparadas, não ativadas
Base publicada consultada: 22 participantes. Alexandre Neto não está no roster atual; foi preparada uma conta administrativa separada, sem criar pontos ou metas fictícios para ele.

O script `scripts/prepare-room-accounts.mjs` preparou 23 acessos individuais fora do repositório, em `../acessos-privados/` (diretório 0700 e arquivos 0600).
Os arquivos privados NÃO devem ser commitados nem publicados em `dist`.
O bootstrap de produção contém somente o hash do administrador; as demais contas serão importadas autenticadas para Netlify Blobs.
Nenhuma senha foi enviada aos participantes. Nenhuma conta remota foi criada nesta etapa.

## Verificações concluídas
- `npm run build`: passou.
- `node --test tests/melhores-room.test.js`: 5 cenários passaram, cobrindo permissões, privacidade, acessos simultâneos, tempo zerado/extensão, validação, revogação de sessão, limite de tentativas e importação sem sobrescrever senhas.
- Chromium/Playwright com três contextos separados: login, sala, rascunho após reload, privacidade, painel e ranking adm, zero sem bloqueio, extensão, revelação, próxima pessoa e encerramento; sem erros JavaScript.
- Interface móvel conferida em 390 × 844. Capturas com dados fictícios em `../previa-celular.png` e `../previa-apresentacao.png`.
- Testes do armazenamento usaram adaptador em memória com compare-and-set, não o store de produção. A conexão real do Netlify precisa ser verificada no deploy.

## Identificação de produção
- Projeto conferido pela API Netlify: `amplidash`.
- Site ID: `34ab08ea-408e-4d4e-98e4-24038dba13fc`.
- A CLI herdou associação com outro site; NÃO usar comandos de deploy/env sem indicar explicitamente o ID correto. Nenhuma associação foi alterada.

## Ativação após autorização explícita
1. Fazer backup atualizado do game-state e conferir alterações em `origin/main` antes de integrar.
2. Configurar no Netlify `amplidash`, com escopo exclusivo de Functions e contexto de produção, `MELHORES_USERS_JSON` do arquivo privado de bootstrap. Não usar prefixo `VITE_`.
3. Integrar a branch na `main`, disparando o deploy automático. Confirmar build e disponibilidade das novas funções.
4. Executar o importador autenticado de contas: `node scripts/import-room-accounts.mjs https://amplidash.netlify.app ../acessos-privados`.
5. Conferir login do administrador e de um participante, bloqueio dos endpoints sem sessão, fluxo com duas sessões e igualdade dos pontos/metas/histórico antes/depois.
6. Entregar o arquivo de acessos exclusivamente ao Alexandre. Não disparar mensagens aos participantes automaticamente.

Não executar essas etapas antes da autorização para publicação: a `main` faz deploy automático.

## Reversão
Se a verificação do deploy falhar, restaurar o deploy anterior no Netlify. Não restaurar o game-state sem necessidade: a nova implementação não o migra. Os stores privados de contas/salas são separados dos pontos/metas.

## Limites desta entrega
- Novo participante criado no painel precisa também receber conta por importação administrativa; não há ainda interface de redefinição de senha.
- O histórico de salas é preservado no servidor, mas não ganhou uma tela própria de consulta nesta entrega.
- “Terminei” informa prontidão e não inicia/encerra a fase automaticamente.
