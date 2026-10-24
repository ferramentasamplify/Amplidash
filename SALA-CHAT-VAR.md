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

## Modo teste
- Somente o administrador da sessão pode habilitar/desabilitar, enquanto a sala aguarda início.
- O modo fica fixo após começar; participantes não podem alterá-lo.
- Sala sinalizada como teste; fluxo de apresentação, voto, VAR e metas permanece disponível.
- Concluir ou encerrar não aplica pontos, penalidades, conquistas ou histórico oficial de fatos. Os dados da sala continuam separados do ranking.
- 29 testes de servidor aprovados, incluindo conclusão/encerramento/releituras sem mutação da pontuação e histórico.

## Cronômetro e animações
- Cada votação (melhor e pior) recebe 5 minutos contados pelo servidor. Todos os clientes usam o mesmo prazo.
- Encerra antes se todos votarem. No prazo final, conta votos recebidos; empate ou zero votos exigem desempate do ADM.
- Relógio fica visível inclusive após votar; últimas 60 segundos em destaque. Votos após o prazo são rejeitados no servidor.
- Votações antigas já abertas recebem cinco minutos uma única vez, sem reiniciar a cada atualização.
- Nome da vez entra com zoom e revelação; abertura “The Best of the Week” cresce de escala pequena para tela cheia. Ambas respeitam redução de movimento.
- 31 testes de servidor e build aprovados.
