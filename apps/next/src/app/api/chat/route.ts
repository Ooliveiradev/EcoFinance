import { db, transactions, accounts, ilike, and, gte, lte, eq, sql } from '@ecofinance/db';

export const maxDuration = 30;

// ---------------------------------------------------------------------------
// Gemini model — gemini-2.0-flash has better function calling and is faster
// ---------------------------------------------------------------------------
const GEMINI_MODEL = 'gemini-2.0-flash';

const SYSTEM_INSTRUCTION = {
  parts: [{
    text: `Você é o assistente financeiro pessoal do EcoFinance.
Você deve ajudar o usuário a entender sua situação financeira e pesquisar gastos.
Sempre que o usuário perguntar sobre gastos ou transações, utilize a ferramenta searchTransactions para buscar no banco de dados antes de responder.
Seja conciso, direto e amigável. Destaque os valores em Reais (R$).
Sempre explique os resultados que encontrar de forma clara.`,
  }],
};

const TOOLS = [{
  functionDeclarations: [{
    name: 'searchTransactions',
    description: 'Pesquisa transações financeiras do usuário no banco de dados com base em filtros de descrição, valor, data ou categoria.',
    parameters: {
      type: 'OBJECT',
      properties: {
        description: { type: 'STRING', description: 'Termo para buscar na descrição da transação (ex: uber, ifood, mercado).' },
        category: { type: 'STRING', description: 'Categoria exata da transação (ex: comida, transporte, lazer, saude, moradia).' },
        minAmount: { type: 'NUMBER', description: 'Valor mínimo da transação (ex: 50.00).' },
        maxAmount: { type: 'NUMBER', description: 'Valor máximo da transação.' },
        startDate: { type: 'STRING', description: 'Data inicial no formato YYYY-MM-DD.' },
        endDate: { type: 'STRING', description: 'Data final no formato YYYY-MM-DD.' },
      },
    },
  }],
}];

export async function POST(req: Request) {
  const { messages } = await req.json();

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { text: 'Erro: GEMINI_API_KEY não configurada no servidor.' },
      { status: 500 },
    );
  }

  // Gemini expects: { role: 'user' | 'model', parts: [{ text: '...' }] }
  const geminiMessages = messages.map((m: { role: string; content: string }) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const makeRequest = (contents: unknown[]) =>
    fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemInstruction: SYSTEM_INSTRUCTION, contents, tools: TOOLS }),
    });

  try {
    let response;
    let data;
    try {
      response = await makeRequest(geminiMessages);
      data = await response.json();
    } catch (fetchError) {
      console.warn('[chat] Google API fetch failed, using fallback mock response:', fetchError);
      return Response.json({ 
        text: 'Olá! Como estamos em um ambiente de desenvolvimento sem acesso à internet, esta é uma resposta simulada. Eu sou o seu Assistente Financeiro! Como posso te ajudar hoje com seus gastos?' 
      });
    }

    if (data.error) {
      return Response.json({ text: `Erro da API do Google: ${data.error.message}` });
    }

    let responseMessage = data.candidates?.[0]?.content?.parts?.[0];

    // ── Handle function calling ──────────────────────────────────────────
    if (responseMessage?.functionCall) {
      const call = responseMessage.functionCall;

      if (call.name === 'searchTransactions') {
        const args = call.args || {};
        const conditions = [];

        if (args.description) conditions.push(ilike(transactions.description, `%${args.description}%`));
        if (args.category)    conditions.push(eq(transactions.category, args.category as 'comida'));
        if (args.minAmount !== undefined) conditions.push(gte(sql`${transactions.amount}::numeric`, args.minAmount));
        if (args.maxAmount !== undefined) conditions.push(lte(sql`${transactions.amount}::numeric`, args.maxAmount));
        if (args.startDate)  conditions.push(gte(transactions.date, new Date(args.startDate)));
        if (args.endDate)    conditions.push(lte(transactions.date, new Date(args.endDate)));

        const results = await db
          .select({
            id: transactions.id,
            description: transactions.description,
            amount: transactions.amount,
            date: transactions.date,
            category: transactions.category,
            accountName: accounts.name,
          })
          .from(transactions)
          .leftJoin(accounts, eq(transactions.accountId, accounts.id))
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(transactions.date)
          .limit(20);

        const toolResponse = {
          count: results.length,
          transactions: results.map((t) => ({
            ...t,
            amount: Number(t.amount),
            date: t.date.toISOString().split('T')[0],
          })),
        };

        // Append the function call + result to the conversation and call again
        geminiMessages.push({ role: 'model', parts: [{ functionCall: call }] });
        geminiMessages.push({
          role: 'user',
          parts: [{ functionResponse: { name: call.name, response: { name: call.name, content: toolResponse } } }],
        });

        response = await makeRequest(geminiMessages);
        data = await response.json();

        if (data.error) {
          return Response.json({ text: `Erro da API do Google: ${data.error.message}` });
        }

        responseMessage = data.candidates?.[0]?.content?.parts?.[0];
      }
    }

    // ── Return final text ────────────────────────────────────────────────
    if (responseMessage?.text) {
      return Response.json({ text: responseMessage.text });
    }

    return Response.json({ text: 'Desculpe, não consegui processar a resposta.' });
  } catch (error) {
    console.error('[chat] Unexpected error:', error);
    return Response.json({ text: 'Desculpe, ocorreu um erro interno.' }, { status: 500 });
  }
}
