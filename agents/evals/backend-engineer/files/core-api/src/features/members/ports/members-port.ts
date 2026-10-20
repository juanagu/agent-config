export interface Member {
  id: string;
  projectId: string;
  displayName: string;
  role: 'owner' | 'editor' | 'viewer';
  status: 'active' | 'invited' | 'suspended';
  email: string;
  passwordHash: string;
}

export interface MembersPort {
  findByProject(projectId: string): Promise<Member[]>;
}
