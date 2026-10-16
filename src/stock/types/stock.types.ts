import type { Stock, StockMovement } from '@prisma/client';

export interface MovementResult {
  movement: StockMovement;
  stock: Pick<Stock, 'quantity' | 'minStock'>;
}
