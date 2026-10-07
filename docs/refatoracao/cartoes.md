# Cartões, faturas e conciliação — EF-07

A web em `/cards` permite cadastrar, editar, arquivar e restaurar cartões, escolher a competência da fatura e revisar compras, parcelas, juros, tarifas, créditos, estornos e pagamentos. O acesso usa a mesma sessão e proteção de origem dos demais fluxos financeiros.

## Competência e caixa

Uma compra de R$ 300 em três parcelas produz um grupo, três parcelas e três despesas de R$ 100, cada uma vinculada à respectiva fatura. Não existe um lançamento adicional de R$ 300. Compra, competência, fechamento, vencimento e liquidação são datas distintas.

As despesas e créditos do cartão ficam `recorded`, sem `paidDate`: contam na competência, sem alterar saldo bancário. O pagamento de fatura é `adjustment` negativo e `settled` na conta de pagamento: reduz caixa e dívida, sem entrar novamente nas despesas. Pode ser parcial; o servidor rejeita pagamento acima do saldo calculado. Conciliar uma saída bancária já liquidada reclassifica o próprio lançamento, sem criar outra saída.

O resumo confere:

`total calculado = saldo anterior + compras/parcelas + juros/tarifas − créditos/estornos`

`saldo da fatura = total calculado − pagamentos`

`diferença = total informado − total calculado`

O total informado é o valor antes dos pagamentos desta fatura. Deixá-lo vazio significa que a conferência ainda não foi feita. Uma divergência permanece visível; o servidor não cria um ajuste para escondê-la. Saldo anterior transporta dívida sem outra despesa; saldo anterior negativo representa crédito transportado. Transportar saldo para a próxima fatura exige confirmação explícita, evitando replicar dívida automaticamente.

## Calendário e confirmação

Dias 29–31 são limitados ao último dia civil do mês. O vencimento fica no mês de fechamento quando posterior ao fechamento real, ou no mês seguinte quando anterior/igual. Uma fatura existente preserva datas e conta de pagamento, mesmo após editar o cartão.

A primeira competência e o número de parcelas vêm da revisão do usuário. A aplicação nunca deduz parcelas futuras de uma descrição importada. É possível revisar o plano antes de confirmar; até 24 parcelas por operação, com centavos restantes nas primeiras parcelas e soma exatamente igual ao total. O limite mantém compras, faturas, parcelas, lançamentos, versões mensais e recibo de idempotência numa transação abaixo de 400 escritas físicas. Novas séries fora desse limite exigem outro incremento com confirmação por lote; não são aceitas silenciosamente. O calendário suporta 2000–2100 e recusa séries/vencimentos fora desse período.

## Conciliação e auditoria

- Uma despesa manual/importada sem vínculos pode virar compra na fatura escolhida. A confirmação informa que sua liquidação anterior é retirada do caixa e sua competência passa a ser a da fatura. `cardOriginal` preserva classificação, status, pagamento e competência anteriores; fonte e identidade externa permanecem.
- Uma linha repetida pode ser conciliada com uma despesa da fatura de mesmo valor. O original permanece arquivado, com `reconciledIntoId` apontando ao lançamento vigente. A identidade externa continua reservada; nova gravação da mesma identidade é recusada. O fluxo manual não permite restaurar uma duplicata conciliada e contar a compra outra vez.
- Uma previsão recorrente pendente da mesma competência, conta e categoria pode ser vinculada à despesa do cartão. Seu valor passa a ser o valor efetivo e deixa de contar como pendência. A tela de planejamento identifica “Conciliada em fatura”; não sugere pagamento bancário já realizado.
- Estorno parcial aponta à despesa original. Reduz despesas na competência/categoria originais e credita a fatura escolhida, inclusive quando posterior à compra. A soma dos estornos não pode superar a despesa. O servidor confere proprietário, cartão e referências; não transforma estorno de cartão em receita bancária.
- Juros/tarifas são despesas; créditos/abatimentos reduzem despesas na competência explicitamente escolhida. O saldo anterior não conta como despesa.

Todas as mutações recebem `Idempotency-Key`. Edições/conciliações/pagamentos conferem `If-Match` e as revisões dos lançamentos selecionados; replays iguais retornam o resultado original e pedidos diferentes com a mesma chave são recusados. As alterações atualizam a revisão dos meses afetados. Meses fechados protegem tanto a competência da fatura quanto competências originais de estornos/conciliações e o mês de liquidação de pagamentos. Referências de outro usuário retornam 404; valores inválidos e injeção de proprietário retornam 400.

## Banco, recuperação e limites de escopo

Os campos são aditivos no catálogo Firestore, com referências dentro do mesmo proprietário. O schema SQL histórico permanece congelado. Backup nativo preserva compras, parcelas, recibos, estados mensais e vínculos de auditoria; exportar esses dados para SQL antigo é recusado para evitar perda de metadados. Nenhum dado de teste é gravado no projeto Firebase real.

Os candidatos de conciliação exibem até 100 registros recentes; o servidor ainda verifica o item selecionado pelo ID e revisão. As consultas financeiras completas recusam truncamento silencioso. A tela responde a falhas de acesso com erro, sem inventar saldo zero.

O fluxo usa lançamentos já cadastrados/importados e explicitamente revisados. Upload, staging, detecção de formato e reversão de lote são entregas de #8/#9. Paridade de telas Expo permanece em #13; esta entrega acrescenta contratos compartilhados e mantém os gates mobile, sem anunciar telas nativas completas. Métricas finais de #12, release/capturas finais de #16/#17 e hospedagem externa permanecem pendentes.

## Validação reproduzível

- Domínio: `packages/shared/src/cards.test.ts` cobre centavos, limites, virada de ano, anos bissextos, calendário, contratos estritos, totais e separação de caixa/competência.
- Firestore: `packages/db/tests/cards.firebase.test.ts` cobre operações concorrentes e replays, pagamento parcial/final, juros/tarifas/créditos/saldo anterior, snapshots, arquivamento de cartão, estorno em outra fatura, duplicatas/identidade externa, pagamentos bancários, recorrências, proprietários, revisões, meses fechados e backup nativo.
- Navegadores: `tests/e2e/cards.spec.ts` exercita cadastro, revisão de parcelas, pagamento, alterações do cartão, conciliação e estorno na interface, divergência visível, segurança e pagamento bancário pela API em Chromium, WebKit e mobile-web. As capturas são geradas em `test-results/cards-*.png`.
- Os comandos de tipos, lint, cobertura, integração PostgreSQL, reversão histórica, build com canários, auditoria de dependências, verificação mobile e React Doctor continuam obrigatórios na CI, incluindo compilação Android nativa.

O encerramento da issue depende da CI completa aprovada e integração do PR; os números e links finais ficam no PR e no ticket.
