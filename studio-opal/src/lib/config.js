export const ADMIN_URL = 'https://ybagmgjseignnyleovee.supabase.co/functions/v1';
export const ADMIN_PROJECT_URL = 'https://ybagmgjseignnyleovee.supabase.co';
export const ADMIN_PUBLIC_KEY = 'sb_publishable_26lQoGkHYUEz7Ln3MrGUxA_fTnzXFVd';
export const ACCOUNT_DOMAIN = 'studio-app.dev';
export const OWNER_EMAIL = 'owner@studio-app.dev';

export const DEFAULT_SETTINGS = {
  keys: { gemini: '', claude: '' },
  models: { gemini: ['gemini-3.7-flash', 'gemini-3.8-flash'], claude: [] },
  providers: [],
  prices: {},
  usage: {},
  // Defaults for every new chat, Agent request and workflow block. A single chat or workflow can still pick another model for itself.
  chatModel: 'gemini-3.7-flash',
  assistantModel: 'gemini-3.7-flash',
  agentModel: 'gemini-3.7-flash', // the default for new workflow blocks
  // When the model in use hits a limit, the next one in this list is tried.
  fallbackOrder: [],
  // How the AI talks to you, and what you asked it to remember. Both are yours to edit.
  persona: '',
  memories: [],
  profileInWorkflows: false,
  // Tell every AI what Studio is and how its features work (about 600 tokens per message).
  appContextOn: true,
  // Switch Web search on by itself when a message needs current information.
  autoSearch: true,
  // Connectors (Gmail and others). Permissions are limits the server enforces; credentials are kept for when a connector is switched on.
  connectors: { gmail: { perms: { read: 'ask', draft: 'ask', send: 'off' }, clientId: '', clientSecret: '' } },
  // Projects (like Claude projects) and which chats belong to which project.
  projects: [],
  chatProject: {},
  voice: 'Kore',
  ttsModel: 'gemini-3.1-flash-tts-preview',
  memory: 20,
};

export const TTS_FALLBACKS = ['gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts'];
export const VOICES = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Aoede', 'Zephyr', 'Leda', 'Orus'];
export const REGIONS = [['ap-south-1', 'Mumbai'], ['ap-southeast-1', 'Singapore'], ['eu-central-1', 'Frankfurt'], ['eu-west-2', 'London'], ['us-east-1', 'N. Virginia'], ['us-west-1', 'N. California']];

// Starting points for the plus button in Settings. Any OpenAI-compatible service works.
export const PRESETS = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', relay: false, noKey: false },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', relay: false, noKey: false },
  { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', relay: false, noKey: false },
  { id: 'nvidia', name: 'NVIDIA', baseUrl: 'https://integrate.api.nvidia.com/v1', relay: true, noKey: false },
  { id: 'ollama', name: 'Ollama (on my computer)', baseUrl: 'http://localhost:11434/v1', relay: false, noKey: true },
  { id: 'lmstudio', name: 'LM Studio (on my computer)', baseUrl: 'http://localhost:1234/v1', relay: false, noKey: true },
  { id: 'custom', name: 'Other (OpenAI-compatible)', baseUrl: '', relay: false, noKey: false },
];
