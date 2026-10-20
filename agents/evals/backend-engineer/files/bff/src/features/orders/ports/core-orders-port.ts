export interface CoreOrder {
  id: string;
  status: 'pending' | 'paid' | 'shipped';
  totalCents: number;
}

export interface CoreOrdersPort {
  getOrder(orderId: string): Promise<CoreOrder>;
}
