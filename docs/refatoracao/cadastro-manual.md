# Cadastro manual web — EF-05

Contas e categorias possuem nome, cor, ordem e arquivo/restauração. Contas têm tipo, moeda BRL e saldo inicial datado; categorias têm ícone. Lançamentos permitem receita, despesa e transferência entre contas próprias, descrição, valor, compra, competência, vencimento, pagamento, status e notas. A interface usa os mesmos contratos e APIs disponíveis ao Expo; a paridade das telas nativas permanece na #13.

## Consistência financeira

Valores são strings decimais validadas e cálculos usam centavos `bigint`. Saldo é o saldo inicial no início do dia informado mais movimentos liquidados com pagamento entre essa data e hoje. Snapshots legados de extrato não entram novamente. Conta sem data inicial ou com abertura futura apresenta saldo indisponível. Despesa/receita mensal usa competência e status registrado/liquidado; previsão, cancelamento e exclusão ficam fora. Transferência gera duas pontas com sinais opostos, mesmo vínculo e revisão, em uma transação Firestore; edição, exclusão e desfazer preservam o par. Não entra como receita/despesa.

Categoria/conta arquivada mantém o histórico e bloqueia novos vínculos. Um lançamento existente pode manter a referência arquivada ao ser corrigido. Exclusão é arquivo reversível, com botão desfazer e filtro de excluídos para restauração após recarregar. Vínculos de cartão/recorrência e transferências legadas sem correlação são recusados para alteração por este fluxo, até reconciliação no módulo responsável.

## API e autorização

Todas as rotas exigem sessão individual e respondem sem cache compartilhado. Proprietário vem da sessão, nunca do corpo. Mutações verificam origem/CSRF antes da leitura do corpo, limitado a 16 KiB.

| Rota | Operações |
| --- | --- |
| `/api/accounts` | GET contas com saldo derivado; POST criar |
| `/api/categories` | GET categorias; POST criar |
| `/api/accounts/:id`, `/api/categories/:id` | PATCH editar; POST `{action: archive ou restore}` |
| `/api/entries` | GET listagem; POST criar |
| `/api/entries/:id` | PATCH editar; DELETE arquivar; POST arquivo/restauração |
| `/api/months/:YYYY-MM/summary` | GET receita, despesa e saldo decimal exatos |

GET entries filtra por ID, conta, categoria, tipo, status, compra inicial/final, competência (primeiro dia do mês), descrição e arquivo. `page` começa em 1; `limit` varia de 1 a 100; resposta contém `entries`, `page`, `hasMore`. Filtragem, ordenação estável por compra/ID e paginação acontecem no servidor/pipeline. Busca de substring e combinação de filtros podem examinar mais documentos do proprietário; não há promessa de custo constante.

Mutações exigem `Idempotency-Key` UUID. Recibo `operations` tem identidade derivada de proprietário/requisição e hash de ação/dados normalizados. O recibo e os movimentos são confirmados juntos: repetição retorna o mesmo resultado; mudar dados com a mesma chave retorna 409. Edição/arquivo/restauração exigem `If-Match` com a revisão atual; conflito retorna 409 e pede recarregar. Referência estrangeira retorna 404, entrada inválida 400, origem hostil 403 e indisponibilidade 503. Cliente preserva a chave durante tentativas do mesmo envio.

## Recuperação e limites

Novos campos são explícitos no catálogo Firestore; `operations` contém histórico de envios. Backup/restore nativo inclui notas, vínculo de transferência, revisões e recibos. O exportador para SQL histórico da #47 recusa qualquer campo novo ou recibo, para impedir perda silenciosa. Uma base que utilizou este cadastro deve ser recuperada com backup nativo e código compatível; reversão SQL requer evolução própria do schema/mapeamento. Os limites atômicos do [runbook Firebase](firebase-migration.md) continuam aplicáveis.

Leituras para saldo/relatórios têm limite de 10 mil registros e falham explicitamente ao excedê-lo. Agregados persistidos, relatórios/projeções finais, retenção/paginação de recibos e backup de grande escala ficam nas issues correspondentes. Esta entrega não encerra #6, #12, #13 ou #14.

## Evidência

Testes de domínio cobrem centavos, datas, saldo inicial, estornos, transferências, exclusão e contratos hostis. Integrações com emulador verificam concorrência/reenvio, revisão, ausência de escrita parcial, dois proprietários, histórico de categoria arquivada, paginação e restauração nativa completa. E2E em build de produção comprova cadastro de conta/categoria, persistência, editar/excluir/desfazer, saldos exatos e API de transferências isolada. Os gates de CI permanecem obrigatórios antes de integrar e encerrar #5.
