# Métricas e relatórios — EF-12

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

## Integração com importações

Após a integração de #8/#9, a validação cobre upload, seleção, correção de valor,
confirmação e desfazer do lote. Durante a revisão, inclusive depois de salvar uma
correção, somente a prévia muda. Após confirmar, os valores corrigidos passam a
compor os relatórios; linhas não selecionadas continuam fora. Desfazer restaura os
totais anteriores, preservando os lançamentos manuais.

O teste de navegador confere os cartões e tabelas de `/reports`, os valores exatos
dos tooltips dos quatro gráficos acionados pelo teclado, o CSV baixado, o dashboard e
o resumo mensal da API. Executa nas visões de competência e caixa em Chromium,
WebKit e viewport móvel. A integração Firestore verifica também categorias e
saldo consolidado. Os cenários de cartão, recorrência, transferência e falha de
leitura permanecem cobertos pelo conjunto conhecido abaixo.

O encerramento da #12 depende da integração deste incremento com CI completa
aprovada. Paridade e execução nativa Android/iOS continuam sob #13; viewport
móvel no navegador não comprova essas jornadas.

## Validação reproduzível

- Domínio: `packages/shared/src/metrics.test.ts` usa um conjunto conhecido com transferências, cartão, parcelas, estorno, pagamento de fatura, recorrências, renda prevista, previstos, ruído arquivado/cancelado e meses vazios.
- Firestore: `packages/db/tests/metrics.firebase.test.ts` cria o conjunto pelos serviços reais e confere competência/caixa, igualdade com planejamento e fatura, projeção, isolamento entre proprietários, CSV e propagação de falhas.
- Navegador: `tests/e2e/reports.spec.ts` compara dashboard, `/reports`, resumo mensal e CSV no mesmo filtro, arquiva um lançamento e confere a atualização, recusa períodos inválidos e acesso anônimo.
- Importações: `packages/db/tests/imports.firebase.test.ts` confere prévia corrigida sem efeitos financeiros, confirmação e desfazer em competência/caixa, categorias, CSV e saldo exato.
- Jornada completa: `tests/e2e/import-reports.spec.ts` usa uma base manual com receita de R$ 100,00 e despesa de R$ 0,30. O lote recebe receita de R$ 20,00 e despesa corrigida de R$ 10,25 para R$ 12,50, mantendo R$ 777,00 não selecionados. Antes do commit os totais são R$ 100,00/R$ 0,30; depois, R$ 120,00/R$ 12,80; após desfazer, R$ 100,00/R$ 0,30.

```sh
pnpm exec vitest run --config vitest.firebase.config.ts packages/db/tests/metrics.firebase.test.ts packages/db/tests/imports.firebase.test.ts
pnpm exec playwright test tests/e2e/reports.spec.ts tests/e2e/import-reports.spec.ts
```

Os comandos exigem o emulador Enterprise no projeto `demo-ecofinance`,
`FIREBASE_PROJECT_ID=demo-ecofinance`, `FIRESTORE_DATABASE_ID=ecofinance` e
`FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`; Playwright exige build web prévio.
