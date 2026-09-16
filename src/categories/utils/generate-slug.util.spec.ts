import { describe, expect, it } from 'vitest';
import { generateSlug } from './generate-slug.util.js';

describe('generateSlug', () => {
  it('lowercases and converts spaces to dashes', () => {
    expect(generateSlug('Eletrônicos')).toBe('eletronicos');
  });

  it('strips accents/diacritics', () => {
    expect(generateSlug('Café Gourmet')).toBe('cafe-gourmet');
  });

  it('strips special characters', () => {
    expect(generateSlug('Roupas & Acessórios!')).toBe('roupas-acessorios');
  });

  it('collapses multiple spaces/underscores and trims edges', () => {
    expect(generateSlug('  Produtos___Especiais  ')).toBe('produtos-especiais');
  });

  it('preserves numbers', () => {
    expect(generateSlug('Categoria 123')).toBe('categoria-123');
  });

  it('leaves an already-kebab-case string unchanged', () => {
    expect(generateSlug('already-kebab-case')).toBe('already-kebab-case');
  });
});
