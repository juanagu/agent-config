import type { Collection } from 'mongodb';
import type { Member, MembersPort } from '../ports/members-port.js';

export class MongoMembersRepository implements MembersPort {
  constructor(private readonly collection: Collection<Member>) {}

  async findByProject(projectId: string): Promise<Member[]> {
    return this.collection.find({ projectId }).toArray();
  }
}
