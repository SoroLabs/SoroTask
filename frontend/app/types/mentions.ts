export interface MentionableEntity {
  id: string;
  type: 'user' | 'task' | 'contract';
  displayName: string;
  avatar?: string;
  metadata?: Record<string, any>;
}

export interface Mention {
  id: string;
  entity: MentionableEntity;
  start: number;
  end: number;
  text: string; // The actual mention text like "@John Doe"
}

export interface MentionTrigger {
  char: string;
  type: MentionableEntity['type'];
  searchFunction: (query: string) => Promise<MentionableEntity[]>;
}