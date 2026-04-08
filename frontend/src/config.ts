// config.ts
// Fonte única da URL da API em todo o projeto.
// Em desenvolvimento: usa http://localhost:5001 como fallback.
// Em produção: lê VITE_API_URL do arquivo .env.production.
export const API = import.meta.env.VITE_API_URL ?? 'http://localhost:5001'