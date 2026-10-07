# Planejamento mensal — issue #6

A web em `/planning?mes=YYYY-MM` mantém recorrências mensais, orçamento e previsões por competência. Os cálculos compartilhados usam centavos inteiros; o aplicativo Expo ainda depende da paridade da #13.

## Utilização

1. Crie conta e categoria no cadastro manual. Em Planejamento, crie uma recorrência com valor fixo/estimado, início/fim, dia de vencimento e lembrete opcional.
2. Use **Gerar previsões do mês** no mês escolhido. A geração não exige cron nem serviço pago; repetir ou executar ao mesmo tempo mantém uma ocorrência por regra/competência. O vencimento deve estar dentro do intervalo de início/fim. Dia 31 cai no último dia de meses menores, inclusive fevereiro bissexto.
3. Pague informando o valor efetivo e a data. A operação cria um único lançamento liquidado e vincula a ocorrência. A previsão sai do pendente e a despesa entra no realizado. Não é necessário cadastrar a mesma despesa no formulário manual.
4. **Adiar** altera o vencimento, preservando a competência. **Editar só esta** modifica descrição/valor/vencimento e protege o ajuste de alterações futuras da regra. Cancelar/Restaurar são reversíveis enquanto não houver pagamento.
5. **Editar / pausar próximas** recebe um mês de início da alteração. As versões anteriores continuam no histórico; pagamentos e ajustes individuais permanecem iguais. Pausar cancela previsões futuras sem ajuste individual; retomar reativa essas previsões. A edição não alcança meses fechados.
6. Defina teto total, renda prevista, reserva e limites independentes por categoria. Valor zero representa teto zero; campo de categoria vazio remove seu limite sem apagar o registro histórico. **Copiar orçamento** exige carregar o mês de origem, revisar todos os campos e confirmar. A cópia não duplica regras recorrentes; a origem alterada após a revisão causa conflito.
7. **Conciliar** reutiliza uma despesa já importada, livre, da mesma conta e competência. Confirme o lançamento e a data; o valor realizado é o do lançamento importado. Nenhum segundo movimento é criado. Um lançamento já liquidado mantém sua data. Upload/revisão multiformato continua na #8/#9; essa ação concilia dados já existentes.
8. **Fechar mês** protege orçamento, ocorrências e lançamentos manuais da competência. Previsões pendentes continuam previstas; resolva-as antes de fechar se desejar. **Reabrir mês** permite correções. Pagamentos permanecem protegidos de edição mesmo depois da reabertura.

O lembrete é apresentado no planejamento nos dias anteriores ao vencimento; esta entrega não envia email/push.

## Significado dos valores

- **Realizado:** despesas e estornos não arquivados, registrados ou liquidados na competência.
- **Previsto a pagar:** ocorrências pendentes e adiadas; pagas/canceladas não entram.
- **Comprometido:** realizado + previsto a pagar.
- **Restante do teto:** teto − comprometido. Negativo indica orçamento excedido.
- **Após a reserva:** renda prevista − comprometido − reserva.
- **Déficit previsto:** a parte negativa do valor após a reserva, mostrada como quanto falta.

Os limites por categoria aplicam a mesma separação entre realizado e previsto. Um mês sem orçamento pede configuração; erro ao carregar não mostra saldos zerados fictícios.

## Persistência e contratos

O proprietário vem da sessão; as entradas não aceitam `ownerId`. Escritas exigem `Idempotency-Key`, validação estrita e proteção de origem/CSRF. Edições exigem revisão via `If-Match`; conflitos retornam 409. Pagamento, conciliação, orçamento e recibo são atômicos. O estado do mês participa da transação, impedindo alterações concorrentes ao fechamento.

- `POST /api/recurrences`, `PATCH /api/recurrences/:id`: criação/versões futuras.
- `GET /api/planning/:month`, `PUT /api/planning/:month`: projeção e orçamento.
- `POST /api/planning/:month/generate`, `/copy`, `/state`: gerar, confirmar cópia revisada, fechar/reabrir.
- `GET /api/planning/copy-preview?from=YYYY-MM`: orçamento de origem e revisão.
- `POST /api/occurrences/:id/{pay,postpone,edit,cancel,restore,reconcile}`: ações com revisão.
- `GET /api/occurrences/:id/candidates`: lançamentos importados elegíveis.

`recurrenceRules.versions` guarda a sequência de configurações efetivas. Cada nova ocorrência tem `snapshot`, revisão, indicação de ajuste individual e vínculo ao pagamento. Campos SQL legados da regra ficam preservados, permitindo ler ocorrências antigas sem reescrever seus valores/descrições. O catálogo Firestore acrescenta esses campos, revisão de orçamento, limite inativo e `planningMonths` (23 coleções). Não há alteração do schema SQL congelado.

O backup nativo inclui versões, snapshots, vínculos, estados dos meses e recibos; o teste restaura o conjunto sem diferenças. Exportação para SQL histórico recusa metadados posteriores ao cutover, conforme o [runbook Firebase](firebase-migration.md).

Limites explícitos: 100 regras recorrentes, 100 ocorrências futuras examinadas e até 60 previsões alteradas por envio, 120 versões por regra, 50 limites de categoria por plano e 100 categorias históricas por orçamento. Consultas completas têm o limite de 10 mil linhas da camada de persistência; candidatos mostram até 100 entradas. Operações acima dos limites falham sem gravação parcial. Para backup maior que o limite atômico do runbook, use exportação gerenciada. Alertas externos, staging completo, métricas finais e paridade nativa ficam nas respectivas issues.

## Evidências

Testes de domínio verificam calendário civil, bissextos/virada de ano, contratos hostis, centavos, estornos, comprometimento e déficit. Testes com Firestore Enterprise emulado cobrem duas gerações concorrentes, pagamento concorrente/repetido, importação conciliada, isolamento, revisão de cópia, fechamento/reabertura, versões futuras e restauração nativa. As jornadas E2E de Chromium, WebKit e viewport Android incluem criação, orçamento por categoria, pagamento, adiar, revisão da cópia, histórico e fechamento. A CI mantém os gates de tipos/lint, cobertura, banco/reversão, builds web/Expo/Android, React Doctor, segurança de bundles/dependências e CodeQL.
