# Sala: chat, VAR e votação

## Alterações
- Chat exclusivo para membros da sala e ADM, com texto de até 1.000 caracteres, emojis, galeria de GIFs e link direto HTTPS do Giphy/Tenor.
- Histórico limitado às 150 mensagens mais recentes por sala; envio limitado a uma mensagem a cada 1,5 segundo por usuário.
- VAR nos resultados do melhor e do pior: maioria absoluta dos participantes da rodada e do ADM (sem duplicação). Ao atingir o limite, bloqueia a próxima etapa até decisão do ADM. A decisão só pode apontar participante da rodada.
- Anúncio de 2,6 segundos com nome grande a cada mudança de jogador.
- Jogador da vez pode mostrar o pior fato e passar ao próximo jogador. ADM mantém os controles; ao terminar a última apresentação, só o ADM abre a votação.
- Votação ocupa o viewport em desktop e celular. Atualizações sem mudança não recriam os candidatos; mudanças preservam a posição de leitura.
- Participantes da rodada têm botão e permissão de voto mesmo com presença atrasada ou se ficaram fora do eleitorado antigo. Votos próprios e duplicados continuam bloqueados.

## Verificação
- 28 testes de servidor aprovados: fluxo existente, chat/permissões/GIF, VAR/maioria/bloqueio, controle de vez e voto com presença atrasada.
- Build Vite aprovado (aviso preexistente de chunks grandes).
- Chromium local com respostas de API simuladas: viewports 1280x844 e 390x844; dimensões da votação, botões, scroll entre polls e contagem alterada, rascunho do chat e anúncio da vez.
- Nenhuma sala ou pontuação em produção alterada durante os testes.

## Publicação
Mudanças preparadas em branch separada. Merge em main aciona o deploy automático do Netlify e deve ocorrer somente após aprovação do Alexandre. Sem nova chave de API ou migração manual: chat e VAR usam o armazenamento privado existente.
