import { Project, Agent, NavItem, StepCard, Workspace, AgentActivity, NotionConnection } from '@/types';

export const navItems: NavItem[] = [
  { label: 'Home', href: '/', icon: 'home', isActive: true },
  { label: 'Projects', href: '/projects', icon: 'folder' },
  { label: 'Research', href: '/research', icon: 'search' },
  { label: 'Outreach', href: '/outreach', icon: 'send' },
  { label: 'Database', href: '/database', icon: 'database' },
  { label: 'Analytics', href: '/analytics', icon: 'bar-chart' },
  { label: 'Integrations', href: '/integrations', icon: 'plug' },
  { label: 'Settings', href: '/settings', icon: 'settings' },
];

export const secondaryNavItems: NavItem[] = [
  { label: 'Integrations', href: '/integrations', icon: 'plug' },
  { label: 'Settings', href: '/settings', icon: 'settings' },
];

export const projects: Project[] = [
  {
    id: '2',
    name: 'Maya Book Awards',
    description: 'Find authors and literary organisations for submissions.',
    prospectsCurrent: 150,
    prospectsTotal: 150,
    qualifiedCount: 85,
    reviewCount: 3,
    status: 'completed',
    accentColor: 'pink',
    icon: '📚',
  },
  {
    id: '3',
    name: 'Sponsorship Outreach',
    description: 'Research and contact potential prize sponsors.',
    prospectsCurrent: 42,
    prospectsTotal: 100,
    qualifiedCount: 15,
    reviewCount: 0,
    status: 'active',
    accentColor: 'purple',
    icon: '🏆',
  },
];

export const agents: Agent[] = [
  {
    id: '1',
    name: 'Brief Analyzer',
    description: 'Understands your goals.',
    status: 'completed',
    progress: 'Complete',
    icon: 'file-text',
    step: 1,
  },
  {
    id: '2',
    name: 'Research Agent',
    description: 'Finds relevant people.',
    status: 'working',
    progress: 'Researching 47/100',
    icon: 'search',
    step: 2,
  },
  {
    id: '3',
    name: 'Personalization Agent',
    description: 'Creates tailored messages.',
    status: 'waiting',
    progress: 'Waiting for research',
    icon: 'sparkles',
    step: 3,
  },
];

export const steps: StepCard[] = [
  { step: 1, title: 'Create a project brief', description: 'Tell MARCOM about your project, goals, target audience and specific requirements.', icon: 'file-edit', isCompleted: true },
  { step: 2, title: 'Connect your Notion database', description: 'Choose an existing database or create a new one with the right columns.', icon: 'database', isCompleted: true },
  { step: 3, title: 'Configure agents', description: 'Review and adjust the research and personalization settings.', icon: 'sliders', isCompleted: true },
  { step: 4, title: 'Start researching', description: 'MARCOM will begin filling your database with researched prospects and personalized messages.', icon: 'play', isCompleted: false },
];

export const workspace: Workspace = {
  name: 'Risidio Workspace',
  plan: 'Guest',
  avatar: 'LM',
  hasProjects: true, // Used to determine if onboarding should collapse
};

export const notionConnection: NotionConnection = {
  isConnected: true,
  databaseName: 'MARCOM Master CRM',
  lastSync: 'Just now',
};

export const recentActivity: AgentActivity[] = [
  {
    id: '1',
    agentName: 'Research Agent',
    agentColor: 'blue',
    action: 'discovered 24 new qualified prospects',
    target: 'Maya Book Awards',
    timestamp: '2m ago',
    isImportant: true,
  },
  {
    id: '2',
    agentName: 'Personalization Agent',
    agentColor: 'pink',
    action: 'generated 18 tailored outreach drafts for review',
    target: 'Maya Book Awards',
    timestamp: '15m ago',
    isImportant: true,
  },
  {
    id: '3',
    agentName: 'Brief Analyzer',
    agentColor: 'purple',
    action: 'updated research parameters based on feedback',
    target: 'Sponsorship Outreach',
    timestamp: '1h ago',
    isImportant: false,
  },
];
