Original prompt: Integrar `src/melhores/` ao Notion oficial do "The Best", sincronizando pontuações manualmente editadas no Notion com o dashboard/jogo e adicionando um botão de zerar pontuação para reset trimestral.

- Decisão: a tabela de classificação do Notion vira o placar oficial para leitura/escrita.
- Decisão: as metas semanais continuam sendo lidas das tabelas manuais de categorias no próprio Notion.
- Decisão: a integração usa uma camada server-side (`/api/melhores/*`) para não expor `NOTION_API_KEY` no frontend.
- Em dev, o Vite responde esses endpoints via middleware local; em produção, os handlers em `api/melhores/*.js` podem ser usados como serverless.
- O botão "Zerar pontuação" zera a classificação atual e o ranking resumido; ele não apaga histórico antigo por padrão.
- Pendências para próxima rodada: validar a integração com um token real do Notion e decidir se vale sincronizar também as linhas históricas semanais por categoria.

- 2026-04-02: adicionada na home do `/melhores` a seção "Melhor da Semana - Descrição do Fato", com tabela histórica para melhor e pior fato da semana.
- 2026-04-02: incluída uma etapa nova no fluxo de votação para registrar data, descrição do melhor fato e descrição do pior fato antes de concluir o `Best of The Week`.
- 2026-04-02: seed inicial do histórico incluído com as semanas de `20/02/2026`, `27/02/2026`, `06/03/2026`, `13/03/2026` e `20/03/2026`, conforme referência enviada pelo usuário.
- 2026-04-02: histórico semanal persistido em `localStorage` separado (`amplify_melhores_history_v1`) para sobreviver aos reloads do dashboard.
- 2026-04-02: `npm run build` validado com sucesso após a adição do histórico semanal.
- 2026-04-02: tentativa de validação visual automatizada bloqueada porque o pacote `playwright` não está disponível no ambiente atual.
- 2026-04-02: adicionada ação manual no menu `Gerenciar` para registrar melhor e pior fato da semana com data, responsável e descrição para cada lado.
- 2026-04-02: otimizado visualmente o pop-up manual de histórico semanal, com modal mais largo, painel de introdução, coluna de data dedicada e cards separados para melhor/pior fato.
- 2026-04-02: simplificada a votação de objetivos para apenas duas opções visuais: `💩` valendo `0` e `⭐` valendo `1`, removendo o botão de `-2`.
- 2026-04-02: Vitor removido da base fixa do jogo e também filtrado do `localStorage` ao carregar, para não reaparecer no dashboard nem nas votações.

- 2026-05-05: adicionado botão de exportar PDF no header do /melhores, com template oculto de relatório e geração adaptada ao ranking geral/top 3 da rodada.
- 2026-05-05: o PDF do /melhores agora resume participantes, pontos acumulados, média por participante, total de Best of The Week e gráfico Top 10.
- 2026-05-05: `npm run build` validado após a implementação do PDF no /melhores.
- 2026-05-05: validação visual automatizada do /melhores bloqueada porque o pacote `playwright` não está disponível no ambiente atual do skill develop-web-game.
- 2026-05-05: PDF do /melhores simplificado para mostrar apenas o campeão geral e os campeões das 6 categorias, removendo gráfico, top 3 e resumos extras.
- 2026-05-05: o histórico de melhor/pior fato do jogo agora só é persistido ao clicar em `Finalizar Votação`; antes disso a entrada fica apenas pendente no fluxo final.
