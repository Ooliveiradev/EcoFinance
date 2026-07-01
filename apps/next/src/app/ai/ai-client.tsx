'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Bot, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export default function AIClient() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: 'Olá! Sou seu assistente financeiro de IA. Como posso te ajudar hoje?',
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const sendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const messageHistory = [...messages, userMessage].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messages: messageHistory }),
      });

      if (!response.ok) {
        throw new Error('Falha na comunicação com o assistente');
      }

      const data = await response.json();

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.text,
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error(error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Desculpe, ocorreu um erro ao tentar processar sua solicitação.',
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] lg:h-[calc(100vh-4rem)] relative bg-slate-950 rounded-2xl border border-slate-800/80 overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 bg-slate-900/80 border-b border-slate-800/80 backdrop-blur-sm z-10 shrink-0">
        <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
          <Bot className="w-5 h-5 text-emerald-400" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Assistente IA</h2>
          <p className="text-xs text-slate-400">Análise inteligente dos seus gastos</p>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 scroll-smooth">
        {messages.map((message) => {
          const isUser = message.role === 'user';
          return (
            <div
              key={message.id}
              className={cn(
                'flex w-full',
                isUser ? 'justify-end' : 'justify-start'
              )}
            >
              <div
                className={cn(
                  'max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 shadow-sm',
                  isUser
                    ? 'bg-emerald-500 text-emerald-50 rounded-br-sm'
                    : 'bg-slate-800 text-slate-100 rounded-bl-sm border border-slate-700/50'
                )}
              >
                {!isUser && (
                  <div className="flex items-center gap-2 mb-1.5">
                    <Bot className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-medium text-emerald-400">Assistente</span>
                  </div>
                )}
                <p className="text-[15px] leading-relaxed whitespace-pre-wrap">
                  {message.content}
                </p>
              </div>
            </div>
          );
        })}
        {isLoading && (
          <div className="flex w-full justify-start">
            <div className="bg-slate-800 rounded-2xl rounded-bl-sm px-4 py-3 border border-slate-700/50 flex items-center gap-3">
              <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
              <span className="text-sm text-slate-400">Analisando...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} className="h-1" />
      </div>

      {/* Input Area */}
      <div className="p-4 bg-slate-900/80 backdrop-blur-md border-t border-slate-800/80 shrink-0">
        <form
          onSubmit={sendMessage}
          className="flex items-end gap-3 max-w-4xl mx-auto"
        >
          <div className="relative flex-1">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Faça uma pergunta sobre seus gastos..."
              className="w-full bg-slate-800/80 text-slate-100 placeholder:text-slate-500 rounded-xl px-4 py-3.5 pr-12 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 border border-slate-700/50 resize-none min-h-[52px] max-h-32 text-sm"
              rows={1}
            />
          </div>
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="h-[52px] w-[52px] rounded-xl bg-emerald-500 text-white flex items-center justify-center hover:bg-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-emerald-500/25 shrink-0"
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5 ml-1" />
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
