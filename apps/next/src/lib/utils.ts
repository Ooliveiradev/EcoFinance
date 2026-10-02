import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateTime = new Intl.DateTimeFormat('pt-BR', { day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'America/Sao_Paulo' });
export function cn(...inputs: ClassValue[]): string { return twMerge(clsx(inputs)); }
export function formatBRL(value: number): string { return currency.format(value); }
export function formatDate(dateStr: string | Date): string { return dateTime.format(new Date(dateStr)); }
