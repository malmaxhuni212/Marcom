export interface Project {
  id: string;
  name: string;
  description: string;
  prospectsCurrent: number;
  prospectsTotal: number;
  qualifiedCount: number;
  reviewCount: number;
  status: 'active' | 'paused' | 'completed' | 'draft';
  accentColor: 'blue' | 'pink' | 'purple' | 'amber';
  icon: string;
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  status: 'idle' | 'working' | 'completed' | 'error' | 'waiting';
  progress?: string;
  icon: string;
  step: number;
}

export interface AgentActivity {
  id: string;
  agentName: string;
  agentColor: 'blue' | 'pink' | 'purple' | 'amber' | 'cyan';
  action: string;
  target: string;
  timestamp: string;
  isImportant?: boolean;
}

export interface NotionConnection {
  isConnected: boolean;
  databaseName?: string;
  lastSync?: string;
}

export interface NavItem {
  label: string;
  href: string;
  icon: string;
  isActive?: boolean;
}

export interface StepCard {
  step: number;
  title: string;
  description: string;
  icon: string;
  isCompleted?: boolean;
}

export interface Workspace {
  name: string;
  plan: string;
  avatar: string;
  hasProjects: boolean;
}
