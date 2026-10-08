# Importação unificada (#8)

Cada arquivo é um lote persistente. Um upload recebe até dez arquivos atomicamente;
cada lote é analisado e confirmado de forma independente, com progresso, destino,
formato e período próprios. Uma falha em um arquivo não cancela os demais nem cria
lançamentos financeiros. O histórico permite retomar o trabalho após recarregar.

## Estados e revisão

`received → processing → review → confirmed → reverted`.
A análise pode terminar em `failed`; recebido, processando e falhou permitem
repetição. Recebido, processando, em revisão e falhou permitem `cancelled`.
Um token de processamento impede análise atrasada de ressuscitar lote cancelado
ou substituir análise mais recente. A ação **Repetir lote** cria nova revisão de
linhas já analisadas, com origem/correções preservadas e seleção desmarcada, sem
alterar o lote anterior ou o saldo. Lotes cancelados antes da análise exigem novo
upload; falhas de análise usam **Repetir análise**.

O arquivo permanece exclusivamente em staging durante a análise/revisão. Sua cópia
bruta em base64 é removida na confirmação ou cancelamento; hash, origem por linha/
célula, trecho original, avisos e correções permanecem. Essa cópia está no banco
privado do proprietário, nunca em URL pública. A leitura pública é autorizada
por sessão, filtra proprietário e exclui o conteúdo bruto da resposta.

Cada linha começa desmarcada. Linhas inválidas permanecem visíveis; datas e valores
incorretos não são descartados nem convertidos por ponto flutuante. O usuário
corrige descrição, valor assinado, data civil, competência e categoria; decide
criar, vincular ou excluir e salva a seleção. A tela impede confirmar correções
ainda não salvas e exige reconhecimento explícito dos dados revisados. Conflitos
de revisão exigem recarregar, conservando a proteção do servidor.

A prévia apresenta receitas, despesas líquidas e impacto adicional no saldo por
competência, com valores exatos em centavos. Vincular e excluir têm impacto zero;
identidades já importadas são verificadas novamente durante a leitura e não são
contadas como gastos adicionais. Nos cartões, positivos são créditos da fatura,
negativos são compras e o impacto bancário é zero até o pagamento da fatura pelo
fluxo próprio de cartões. Contas recebem movimentos liquidados na data da linha.
Este primeiro fluxo exige escolher explicitamente a conta/cartão de destino:
identificação bancária em OFX não cria ou seleciona conta silenciosamente.

## Detecção e limites

O registro `importParsers` expõe contratos `detect` e `parse`, com resultado comum
e proveniência extensível a página, linha e célula. A assinatura/conteúdo escolhe
o parser; MIME divergente gera aviso e a extensão é apenas uma pista. Nenhum
conteúdo executável ou entidade XML é expandido.

- OFX/QFX (SGML/XML), CSV/TSV (UTF-8, UTF-16, Windows-1252) e XLS/XLSX, com
  mapeamento assistido de colunas, perfis salvos, escolha de aba e evidência por
  célula, estão descritos em [formatos.md](formatos.md) (#9).
- Arquivos vazios, truncados, binários, codificação inválida, colunas ambíguas,
  moeda incompatível e limites excedidos retornam diagnóstico acionável.
- PDF orienta exportar outro formato; interpretação PDF/OCR é #10. Não há promessa
  de suporte universal.

Limites: dez arquivos por upload, 256 KiB e sessenta linhas por arquivo, seis
competências por confirmação e cem referências de importação por lançamento.
O corpo multipart é limitado durante a leitura do stream, independentemente de
`Content-Length`. Essas fronteiras mantêm a transação abaixo dos limites de
documentos/bytes do Firestore, inclusive com claims de unicidade e faturas.
Arquivos maiores devem ser exportados em períodos menores; o sistema não divide
uma confirmação silenciosamente em commits parciais.

## Atomicidade, duplicidades e desfazer

Recepção, correções, cancelamento, confirmação e desfazer usam chave idempotente
e registro de operação por proprietário. A confirmação valida a revisão do lote,
seleção, referências ativas e meses abertos. Lançamentos, vínculos, faturas,
linhas confirmadas, meses e operação são gravados na mesma transação Firestore.
Falha em qualquer escrita deixa todo o lote em revisão, sem importação parcial.
Cliques simultâneos com chaves iguais ou diferentes confirmam apenas uma vez.
Consultas da interface são atualizadas após o commit.

Identidade determinística: proprietário + destino + namespace/FITID OFX, ou hash
SHA-256 do arquivo + posição quando não existe FITID. Claims de unicidade permanecem
no adaptador do banco. O mesmo arquivo, inclusive renomeado, vincula seu lançamento
existente sem repetir gasto. Dados divergentes ou arquivamento manual com a mesma
identidade geram conflito para revisão do original, nunca substituição. Repetir
um lote revertido pode restaurar somente o arquivamento feito pelo próprio
desfazer, com revisão intacta e nenhuma referência alheia; exige nova confirmação
explícita. A prévia conta essa restauração como impacto financeiro adicional.
FITID repetido no mesmo lote exige excluir uma das linhas antes de confirmar.
Compras iguais em arquivos distintos sem identidade comprovada são candidatos;
podem ser criadas ou vinculadas explicitamente, após conferir todos os campos.
Um vínculo exige mesmo destino, valor, descrição, data, competência, categoria,
tipo financeiro e situação de liquidação. Não reclassifica transferência ou
pagamento de fatura como despesa.

Desfazer remove apenas a referência deste lote. Arquiva de forma reversível
lançamentos criados por ele que permanecem com a revisão original e sem outras
referências/vínculos. Edições posteriores, estornos, recorrências, parcelas,
transferências, conciliações e referências de outros lotes preservam o lançamento
e registram o motivo por linha. Faturas e meses são recalculados atomicamente.
Meses fechados bloqueiam alterações financeiras também no desfazer. Desfazer um
lote que somente vinculou lançamentos nunca apaga esses lançamentos. Se o lote
criador já foi revertido preservando referência alheia, desfazer posteriormente
essa referência também preserva o gasto: não há exclusão tardia inesperada.

`POST /api/transactions/import-ofx` agora usa o mesmo contrato multipart de
`POST /api/imports`: `files` repetido e exatamente um `accountId`/`cardId`. Recebe
somente staging. O contrato antigo de gravação direta permanece desativado.

## Evidência

- Testes unitários de contratos, dinheiro, detecção, CSV com aspas/quebras,
  OFX válido/inválido, assinaturas binárias e limites, incluídos no gate de cobertura.
- Integração Enterprise emulada: staging sem saldo, seleção, concorrência com
  chaves iguais/distintas, reimportação, duplicidades cruzadas, falha na segunda
  escrita, desfazer após edição, cartões/créditos, backup/restore, isolamento,
  cancelamento concorrente, análise atrasada, mês fechado, sessenta linhas,
  repetição idempotente e restauração protegida após desfazer.
- E2E em Chromium, WebKit e viewport móvel: upload múltiplo, correção, prévia,
  confirmação selecionada, recarga, desfazer, diagnósticos e autorização/CSRF.
- Tipos, lint sem avisos, build de produção, React Doctor e scanners de privacidade.

A integração/encerramento de #8 depende do gate completo do PR. Execução em
produção e paridade financeira nativa Expo não são comprovadas por estes testes.
