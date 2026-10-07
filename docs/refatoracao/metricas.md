# Métricas e relatórios — EF-12 (parcial)

`Meu mês`, `/reports`, `GET /api/reports`, `GET /api/reports/export` e `GET /api/months/:month/summary` usam um único cálculo: `packages/shared/src/metrics.ts`. O pacote compartilhado não depende de Next nem de banco, então o Expo pode consumir a mesma API ou as mesmas funções.

## Regras

| Visão | Entra | Fica fora |
| --- | --- | --- |
| Competência | Receitas, despesas e estornos `recorded`/`settled` do mês de referência; compras e parcelas de cartão | Transferências, pagamento de fatura (`adjustment`), lançamentos previstos/cancelados/arquivados, saldo inicial |
| Fluxo de caixa | Movimentos `settled` pela data de pagamento, inclusive pagamento de fatura | Transferências entre contas próprias, compras de cartão ainda não pagas, saldo inicial |

- Compra de R$ 300 em 3×100 soma R$ 100 por competência; pagar a fatura reduz caixa e não cria outra despesa.
- **Fixos**: lançamentos de recorrência ou parcela. Um estorno segue a classificação da compra original (`refundOfId`). O restante é **variável**.
- **Previsto × realizado** usa sempre competência e a mesma regra de `planningSummary`: pendente = recorrências `pending`/`postponed`; uma recorrência paga conta só como realizada. Mês sem orçamento aparece como “Sem orçamento”, nunca como limite zero.
- **Disponibilidade projetada** = saldo consolidado até hoje (ou fim do mês) + receita ainda prevista no orçamento − compromissos restantes (recorrências pendentes, despesas previstas e saldo aberto das faturas do mês). A fórmula aparece com cada termo em `Meu mês`. Saldo de conta sem abertura válida deixa a projeção “indisponível”.
- **Tendência**: só existe quando o mês anterior teve lançamentos na mesma visão; caso contrário, “Sem referência”.
- Totais em centavos inteiros e strings decimais exatas; `number` apenas para geometria dos gráficos.

## Consistência e atualização

- Tabela, gráficos, cartões e CSV de `/reports` saem do mesmo objeto `MetricsReport` para o mesmo filtro (`de`, `ate`, `base`). O CSV usa formato longo (`seção;período;base;item;valor`), com BOM UTF-8 e proteção contra fórmulas em células de texto.
- A leitura usa uma transação Firestore (snapshot consistente). Nada é persistido como agregado: CRUD, conciliação, operações de cartão e confirmação/reversão de importação aparecem na próxima leitura.
- A prévia de importação fica em itens de lote, não em lançamentos, e não entra nos números confirmados.
- Falha de leitura, inclusive o limite de 10 mil registros, gera erro explícito: `Meu mês` não recebe nenhum número e a API responde 503. Período inválido ou acima de 12 meses → 400.

## Pendências da issue

A integração com o fluxo completo de importação (#8/#9) só pode ser comprovada após esses PRs: "importar, corrigir ou desfazer um lote atualiza todos os componentes" e "prévia separada dos números confirmados" dependem do pipeline de lotes. Telas Expo de relatório ficam com #13; o contrato `/api/reports` já é compartilhado.

## Validação reproduzível

- Domínio: `packages/shared/src/metrics.test.ts` usa um conjunto conhecido com transferências, cartão, parcelas, estorno, pagamento de fatura, recorrências, renda prevista, previstos, ruído arquivado/cancelado e meses vazios.
- Firestore: `packages/db/tests/metrics.firebase.test.ts` cria o conjunto pelos serviços reais e confere competência/caixa, igualdade com planejamento e fatura, projeção, isolamento entre proprietários, CSV e propagação de falhas.
- Navegador: `tests/e2e/reports.spec.ts` compara dashboard, `/reports`, resumo mensal e CSV no mesmo filtro, arquiva um lançamento e confere a atualização, recusa períodos inválidos e acesso anônimo.
