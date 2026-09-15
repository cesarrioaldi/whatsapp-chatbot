export interface Config {
  llmApiUrl: string;
  llmApiKey: string;
  llmModel: string;
  botName: string;
  maxTokens: number;
  temperature: number;
  agentsMdPath: string;
  databasePath: string;
  panelPort: number;
  panelPassword: string;
  maxMessageLength: number;
}

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatHistory {
  [chatId: string]: Message[];
}

export interface AgentsConfig {
  systemPrompt: string;
  rawContent: string;
}

// User profile stored in database
export interface UserProfile {
  whatsappId: string;
  name: string;
  height: number; // cm
  weight: number; // kg
  targetWeight: number; // kg
  age?: number;
  birthYear?: number;
  gender?: 'male' | 'female';
  activityLevel: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
  goal: 'lose' | 'gain' | 'maintain';
  tdee?: number; // Total Daily Energy Expenditure
  targetCalories?: number;
  onboardingCompleted: boolean;
  createdAt: string;
  updatedAt: string;
}

// Food/drink entry
export interface FoodEntry {
  id?: number;
  whatsappId: string;
  date: string; // YYYY-MM-DD
  timestamp: string;
  type: 'food' | 'drink';
  description: string;
  calories: number;
  protein?: number;
  carbs?: number;
  fats?: number;
}

// Activity entry
export interface ActivityEntry {
  id?: number;
  whatsappId: string;
  date: string; // YYYY-MM-DD
  timestamp: string;
  description: string;
  duration?: number; // minutes
  caloriesBurned?: number;
}

// Weight log
export interface WeightLog {
  id?: number;
  whatsappId: string;
  date: string;
  weight: number;
  notes?: string;
}

// Daily summary
export interface DailySummary {
  date: string;
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFats: number;
  foodCount: number;
  activityCount: number;
  caloriesBurned: number;
}
