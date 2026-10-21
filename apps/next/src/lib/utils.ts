import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateTime = new Intl.DateTimeFormat('pt-BR', { day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'America/Sao_Paulo' });
export function cn(...inputs: ClassValue[]): string { return twMerge(clsx(inputs)); }
export function formatBRL(value: number): string { return currency.format(value); }
export function formatDate(dateStr: string | Date): string { return dateTime.format(new Date(dateStr)); }
// Civil dates (YYYY-MM-DD) have no instant: formatting them as timestamps shifts the day in UTC-3.
const civilDate = new Intl.DateTimeFormat('pt-BR', { day:'2-digit',month:'short',year:'numeric',timeZone:'UTC' });
export function formatCivilDate(value: string): string { return civilDate.format(new Date(value + 'T00:00:00Z')); }
