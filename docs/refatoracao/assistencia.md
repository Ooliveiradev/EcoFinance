# Assistência de categorização (#11)

A importação sugere a categoria de cada linha sem depender de API paga. A
sugestão só **pré-seleciona** a categoria na revisão: a linha continua
"Categoria a revisar" até o usuário salvá-la, e nada é lançado sem a confirmação
do lote ([importacoes.md](importacoes.md)). Cálculos, totais e gráficos não passam
por modelo nenhum.

## Ordem das fontes

1. **Regras do usuário** (Configurações → Regras de categoria): "descrição contém
   X → categoria Y". Nunca são sobrescritas pelo aprendizado.
2. **Regras aprendidas:** ao salvar uma linha revisada (criar ou vincular), a
   descrição normalizada passa a apontar para a categoria escolhida. Uma nova
   escolha para a mesma descrição substitui a anterior.
3. **Modelo local (opcional):** só para as linhas que sobraram sem regra, quando
   o operador configura um servidor Ollama.

Sem regra e sem modelo, a linha fica sem sugestão e o fluxo manual segue igual.
Categorias arquivadas nunca são sugeridas. Uma regra que aponte para uma categoria
arquivada fica sem efeito e aparece assim na tela.

### Normalização e casamento

`ruleKey` coloca o texto em minúsculas e remove acentos, dígitos, datas e
pontuação, de modo que `PIX 12/09 PADARIA ÉXEMPLO*123` e `pix padaria exemplo`
geram a mesma chave. A regra aprendida exige a chave inteira igual. A regra do
usuário casa palavras inteiras contidas na chave (`padaria` não casa
`padariasul`). Precedência: usuário, depois igualdade, depois o padrão mais longo.
Textos com menos de três letras não geram regra.

As regras ficam no documento `preferences` do próprio usuário
(`settings.categoryRules`), ao lado dos perfis de mapeamento da #9. São até 200
regras; acima disso caem primeiro as aprendidas mais antigas. Backup, restauração
e exclusão de dados já cobrem esse documento.

## Modelo local (Ollama)

Variáveis apenas no servidor (`.env`):

| Variável | Efeito |
| --- | --- |
| `OLLAMA_URL` | Endereço do Ollama, por exemplo `http://127.0.0.1:11434`. Sem ela, o modelo fica desligado |
| `IMPORT_ASSIST_MODEL` | Modelo já baixado no Ollama, por exemplo `qwen2.5:3b` |
| `IMPORT_ASSIST_TIMEOUT_MS` | Tempo máximo da chamada (padrão 15 s, máximo 30 s) |
| `IMPORT_ASSIST=off` | Desliga o modelo mesmo com as variáveis acima |

O endereço do servidor nunca é exposto ao navegador; a tela mostra só o nome do
modelo. No Cloud Run atual o modelo fica desligado (não há Ollama). O uso previsto
é a instalação própria, com o Ollama na mesma máquina ou rede.

### Garantias

- **Dados mínimos:** vão ao modelo só a descrição (até 200 caracteres), o valor e
  o nome das categorias ativas. Ids, contas, datas e o arquivo original não vão.
- **Saída restrita:** as categorias são oferecidas por códigos curtos (`c1`…), e
  a resposta é limitada por JSON Schema (`format` do Ollama) e validada em código.
  Código inexistente, linha inexistente, duplicata ou `nenhuma` são descartados.
  O modelo não pode criar categoria; categorias novas só são criadas pelo usuário.
- **Prompt injection:** as descrições vão como dados JSON, e a instrução de sistema
  manda ignorar comandos que apareçam nelas. Mesmo que o modelo obedeça a um texto
  injetado, o pior caso é sugerir outra categoria existente, que o usuário vê e
  corrige antes de salvar. O modelo não tem ferramentas, não escreve no banco e não
  recebe totais.
- **Limites:**
  - Uma chamada por análise de lote, com até 60 linhas e 100 categorias.
  - Resposta de no máximo 64 KiB, `temperature: 0` e sem redirecionamentos.
  - Uma chamada por processo; um lote simultâneo segue sem modelo.
  - A análise só chama o modelo quando levou menos de 30 s até ali, para respeitar
    o timeout de 60 s do Cloud Run.
- **Falhas:** servidor fora do ar, timeout, HTTP de erro, JSON inválido ou resposta
  grande demais viram um aviso no lote. Não há outra tentativa, troca por provedor
  pago nem chute.
- **Motivo:** o texto do modelo aparece como texto puro (sem `<`, `>` ou caracteres
  de controle, até 160 caracteres), sempre com o nome do modelo e o pedido de
  conferência.

Nenhum provedor externo foi implementado: por decisão do mantenedor, nenhum dado
financeiro sai do servidor.

## Avaliação do modelo local

`apps/next/src/lib/assist-ollama.eval.test.ts` usa 21 descrições sintéticas, em
7 categorias, incluindo uma tentativa de prompt injection. Ele mede acerto e
latência e exige 70% de acerto e nenhuma categoria fora da lista. Só roda com o
Ollama configurado:

```bash
OLLAMA_URL=http://127.0.0.1:11434 IMPORT_ASSIST_MODEL=qwen2.5:3b npx vitest run apps/next/src/lib/assist-ollama.eval.test.ts
```

**Ainda não executado:** esta máquina de desenvolvimento não tem Ollama. Os
resultados de acerto e latência e os requisitos de hardware medidos entram aqui
após a primeira execução. Referência a validar: modelos de 1,5–3 B parâmetros
quantizados em 4 bits ocupam cerca de 1–2 GiB de RAM e rodam na CPU. Sem hardware
adequado, deixe `OLLAMA_URL` vazio e as regras continuam funcionando.

## API

- `GET /api/category-rules`: `{ rules, assistant: { model } | null }`.
- `POST /api/category-rules`: `{ pattern, categoryId }` cria uma regra do usuário
  (`Idempotency-Key`). A categoria precisa ser ativa e do próprio usuário.
- `DELETE /api/category-rules/{id}`: exclui uma regra, aprendida ou do usuário.
- As linhas de `GET /api/imports/{id}` trazem `suggestion` com `categoryId`,
  `source` (`rule` ou `model`), `reason`, e `ruleId` ou `model`.

## Validação

- `packages/shared/src/assist.test.ts`: normalização, precedência, palavras inteiras
  e validação de entrada.
- `apps/next/src/lib/assist-ollama.test.ts`, com Ollama falso:
  - Configuração.
  - Corpo enviado: sem ids e com schema.
  - Descarte de códigos injetados, linhas inexistentes e duplicatas.
  - Erro HTTP, JSON inválido, resposta grande, rede fora e timeout.
  - Uma chamada por processo.
- `packages/db/tests/category-rules.firebase.test.ts`, no emulador:
  - Aprendizado na revisão e sugestão na importação seguinte, sem categorizar a
    linha.
  - Precedência da regra do usuário e categoria arquivada.
  - Exclusão de regra.
  - Modelo chamado só para linhas sem regra, e falha do modelo.
- `tests/e2e/category-rules.spec.ts`: regra criada nas configurações e categoria
  pré-selecionada na revisão, com a linha ainda pendente.

## Fora deste incremento

- Assistência ao mapeamento de colunas ambíguas (#9) e à organização do texto de
  OCR (#10) pelo modelo. As regras determinísticas e o mapeamento manual
  continuam.
- Chat e explicação de métricas: `/api/chat` segue desativado.
- Sugestões no app Expo: o campo já vem na API, mas o app ainda não o mostra.
