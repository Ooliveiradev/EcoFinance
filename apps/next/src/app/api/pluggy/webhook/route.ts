import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    // A Pluggy envia o POST para a nossa URL.
    // Usamos um token na URL (?token=...) para validar que é realmente a Pluggy
    const url = new URL(request.url);
    const token = url.searchParams.get('token');
    
    if (token !== process.env.API_SECRET_KEY) {
      console.warn('[Pluggy Webhook] Tentativa de acesso não autorizada');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    console.log('[Pluggy Webhook] Evento recebido:', body);

    const { event, itemId } = body;

    // Se o banco terminou de atualizar novas transações
    if (event === 'item/updated' && itemId) {
      console.log(`[Pluggy Webhook] Iniciando sincronização automática para o itemId: ${itemId}...`);
      
      const baseUrl = request.nextUrl.origin;
      
      // Chamamos nossa própria rota de sincronização
      const syncResponse = await fetch(`${baseUrl}/api/pluggy/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-secret-key': process.env.API_SECRET_KEY || ''
        },
        body: JSON.stringify({ itemId })
      });

      if (!syncResponse.ok) {
        console.error('[Pluggy Webhook] Erro ao sincronizar:', await syncResponse.text());
        return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
      }

      console.log('[Pluggy Webhook] Sincronização automática concluída com sucesso!');
      return NextResponse.json({ received: true, synced: true });
    }
    
    // Para outros eventos (item/waiting_user_input, item/error, etc), nós apenas registramos
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('[Pluggy Webhook] Erro:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
