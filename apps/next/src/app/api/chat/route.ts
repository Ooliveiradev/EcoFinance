import { db, transactions, accounts } from '@ecofinance/db';
import { ilike, and, gte, lte, eq, sql } from 'drizzle-orm';

export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages } = await req.json();

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ text: "Erro: GEMINI_API_KEY não configurada." }, { status: 500 });
  }

  // Format history for Gemini API
  // Gemini expects: { role: 'user' | 'model', parts: [{ text: '...' }] }
  const geminiMessages = messages.map((m: any) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  const systemInstruction = {
    parts: [{
      text: `Você é o assistente financeiro pessoal do EcoFinance.
Você deve ajudar o usuário a entender sua situação financeira e pesquisar gastos.
Sempre que o usuário perguntar sobre gastos ou transações, utilize a ferramenta searchTransactions para buscar no banco de dados antes de responder.
Seja conciso, direto e amigável. Destaque os valores em Reais (R$).
Sempre explique os resultados que encontrar de forma clara.`
    }]
  };

  const tools = [{
    functionDeclarations: [{
      name: "searchTransactions",
      description: "Pesquisa transações financeiras do usuário no banco de dados com base em filtros de descrição, valor, data ou categoria.",
      parameters: {
        type: "OBJECT",
        properties: {
          description: { type: "STRING", description: "Termo para buscar na descrição da transação (ex: uber, ifood, mercado)." },
          category: { type: "STRING", description: "Categoria exata da transação (ex: comida, transporte, lazer, saude, moradia)." },
          minAmount: { type: "NUMBER", description: "Valor mínimo da transação (ex: 50.00)." },
          maxAmount: { type: "NUMBER", description: "Valor máximo da transação." },
          startDate: { type: "STRING", description: "Data inicial no formato YYYY-MM-DD." },
          endDate: { type: "STRING", description: "Data final no formato YYYY-MM-DD." }
        }
      }
    }]
  }];

  try {
    let url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`;
    
    let response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction,
        contents: geminiMessages,
        tools
      })
    });

    let data = await response.json();
    console.log("GEMINI DATA 1:", JSON.stringify(data, null, 2));
    let responseMessage = data.candidates?.[0]?.content?.parts?.[0];

    // Check if the model decided to call the tool
    if (responseMessage && responseMessage.functionCall) {
      const call = responseMessage.functionCall;
      if (call.name === 'searchTransactions') {
        const args = call.args || {};
        
        // Execute the database query
        const conditions = [];
        if (args.description) {
          conditions.push(ilike(transactions.description, `%${args.description}%`));
        }
        if (args.category) {
          conditions.push(eq(transactions.category, args.category as any));
        }
        if (args.minAmount !== undefined) {
          conditions.push(gte(sql`${transactions.amount}::numeric`, args.minAmount));
        }
        if (args.maxAmount !== undefined) {
          conditions.push(lte(sql`${transactions.amount}::numeric`, args.maxAmount));
        }
        if (args.startDate) {
          conditions.push(gte(transactions.date, new Date(args.startDate)));
        }
        if (args.endDate) {
          conditions.push(lte(transactions.date, new Date(args.endDate)));
        }

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
          transactions: results.map(t => ({
            ...t,
            amount: Number(t.amount),
            date: t.date.toISOString().split('T')[0],
          })),
        };

        // Append the model's function call and our tool response to the conversation history
        geminiMessages.push({
          role: 'model',
          parts: [{ functionCall: call }]
        });
        
        geminiMessages.push({
          role: 'user',
          parts: [{
            functionResponse: {
              name: call.name,
              response: { name: call.name, content: toolResponse }
            }
          }]
        });

        // Make the second API call to get the final text response based on the tool result
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction,
            contents: geminiMessages,
            tools
          })
        });
        data = await response.json();
        responseMessage = data.candidates?.[0]?.content?.parts?.[0];
      }
    }

    if (data.error) {
      return Response.json({ text: `Erro da API do Google: ${data.error.message}` });
    }

    if (responseMessage && responseMessage.text) {
      return Response.json({ text: responseMessage.text });
    }

    return Response.json({ text: "Desculpe, não consegui processar a resposta." });
  } catch (error) {
    console.error(error);
    return Response.json({ text: "Desculpe, ocorreu um erro interno." }, { status: 500 });
  }
}
