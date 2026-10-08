import React from 'react';
import { Text } from 'react-native';
import { money } from '../data/format';
import { read } from '../data/resources';
import { useStack } from '../navigation';
import { useData, useResource } from '../ui/data-context';
import { Bar, Box, Button, ErrorState, Loading, MoneyLine, MonthBar, Muted, Screen, SourceBanner, Title } from '../ui/kit';
import { styles } from '../ui/theme';

/** Meu mês: totals, categories and projection from the same shared report the web shows. */
export function MonthScreen() {
  const { month, setMonth, outbox } = useData();
  const navigation = useStack();
  const { loaded, error, loading, refreshing, reload } = useResource('report.' + month, () => read.report(month));
  const pending = outbox.length;
  const row = loaded?.data.report.months[0];
  const projection = loaded?.data.projection;
  return <Screen refreshing={refreshing} onRefresh={reload}>
    <MonthBar month={month} onChange={setMonth} />
    {pending ? <Box tone="warning">
      <Text style={styles.strongText}>{pending} alteração(ões) pendente(s) neste aparelho</Text>
      <Muted>Os totais abaixo só incluem o que o servidor já confirmou.</Muted>
      <Button label="Ver pendências" variant="secondary" onPress={() => navigation.navigate('Pending')} />
    </Box> : null}
    <Button label="Novo lançamento" onPress={() => navigation.navigate('EntryForm', {})} />
    {loading ? <Loading /> : null}
    {error ? <ErrorState error={error} onRetry={reload} /> : null}
    {loaded && row && projection ? <>
      <SourceBanner loaded={loaded} />
      <Box>
        <Title>Resumo por competência</Title>
        <MoneyLine label="Receitas" value={row.income} />
        <MoneyLine label="Despesas" value={row.expenses} />
        <MoneyLine label="Resultado do mês" value={row.net} strong />
        <Muted>{row.count} lançamento(s) · fixos {money(row.fixed)} · variáveis {money(row.variable)}</Muted>
      </Box>
      <Box>
        <Title>Projeção</Title>
        <MoneyLine label="Saldo atual das contas" value={projection.balance} missing="indisponível: conta sem saldo inicial" />
        <MoneyLine label="Renda prevista" value={projection.expectedIncome} missing="sem orçamento" />
        <MoneyLine label="A receber" value={projection.toReceive} missing="sem orçamento" />
        <MoneyLine label="Recorrências pendentes" value={projection.commitments.recurring} />
        <MoneyLine label="Despesas previstas" value={projection.commitments.planned} />
        <MoneyLine label="Faturas em aberto" value={projection.commitments.invoices} />
        <MoneyLine label="Disponível projetado" value={projection.projected} missing="indisponível" strong />
        <Muted>{projection.formula}</Muted>
      </Box>
      <Box>
        <Title>Despesas por categoria</Title>
        {loaded.data.report.categories.length === 0 ? <Muted>Nenhuma despesa registrada neste mês.</Muted> : null}
        {loaded.data.report.categories.map(category => <Bar key={category.id} label={category.name} value={category.amount} share={Number(category.share)} color={category.color} />)}
      </Box>
    </> : null}
  </Screen>;
}
