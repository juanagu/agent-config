// src/shared/repositories/order-repository.ts (excerpt: 210 lines in the real file)
import { Collection, ObjectId } from 'mongodb';
import type { OrderDocument } from '../types/order';

export class OrderRepository {
  constructor(private readonly orders: Collection<OrderDocument>) {}

  findById(id: string) {
    return this.orders.findOne({ _id: new ObjectId(id) });
  }

  listByCustomer(customerId: string) {
    return this.orders.find({ customerId }).sort({ createdAt: -1 }).toArray();
  }

  markCancelled(id: string, reason: string) {
    return this.orders.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: 'cancelled', cancelReason: reason } },
    );
  }

  markShipped(id: string, trackingCode: string) {
    return this.orders.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: 'shipped', trackingCode } },
    );
  }

  // ... 12 more methods: discounts, restock, export, search, stats
}
