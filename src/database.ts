import Database from 'better-sqlite3';
import { config, getTodayWIB, getNowWIB } from './config';
import path from 'path';
import fs from 'fs';
import {
  UserProfile,
  FoodEntry,
  ActivityEntry,
  WeightLog,
  DailySummary,
} from './types';

export class DatabaseService {
  private db: Database.Database;

  constructor() {
    // Ensure data directory exists
    const dbDir = path.dirname(config.databasePath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.db = new Database(config.databasePath);
    this.initTables();
    console.log('✓ Database initialized');
  }

  private initTables(): void {
    // Users table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        whatsapp_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        height REAL NOT NULL,
        weight REAL NOT NULL,
        target_weight REAL NOT NULL,
        age INTEGER,
          birth_year INTEGER,
          gender TEXT,
        activity_level TEXT NOT NULL,
        goal TEXT NOT NULL,
        tdee REAL,
        target_calories REAL,
        onboarding_completed INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    // Food entries table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS food_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        whatsapp_id TEXT NOT NULL,
        date TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        type TEXT NOT NULL,
        description TEXT NOT NULL,
        calories REAL NOT NULL,
        protein REAL,
        carbs REAL,
        fats REAL,
        FOREIGN KEY (whatsapp_id) REFERENCES users(whatsapp_id)
      )
    `);

    // Activities table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS activities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        whatsapp_id TEXT NOT NULL,
        date TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        description TEXT NOT NULL,
        duration INTEGER,
        calories_burned REAL,
        FOREIGN KEY (whatsapp_id) REFERENCES users(whatsapp_id)
      )
    `);

    // Weight logs table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS weight_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        whatsapp_id TEXT NOT NULL,
        date TEXT NOT NULL,
        weight REAL NOT NULL,
        notes TEXT,
        FOREIGN KEY (whatsapp_id) REFERENCES users(whatsapp_id)
      )
    `);

    // Create indices for better query performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_food_date ON food_entries(whatsapp_id, date);
      CREATE INDEX IF NOT EXISTS idx_activities_date ON activities(whatsapp_id, date);
      CREATE INDEX IF NOT EXISTS idx_weight_date ON weight_logs(whatsapp_id, date);
    `);

    // Migration: add birth_year column for existing DBs
    const cols = this.db.prepare("PRAGMA table_info(users)").all() as any[];
    if (!cols.some((c: any) => c.name === 'birth_year')) {
      this.db.exec('ALTER TABLE users ADD COLUMN birth_year INTEGER');
      console.log('✓ Migration: added birth_year column');
    }
  }

  // User methods
  getUserProfile(whatsappId: string): UserProfile | null {
    const stmt = this.db.prepare(`
      SELECT * FROM users WHERE whatsapp_id = ?
    `);
    const row = stmt.get(whatsappId) as any;
    
    if (!row) return null;

    return {
      whatsappId: row.whatsapp_id,
      name: row.name,
      height: row.height,
      weight: row.weight,
      targetWeight: row.target_weight,
      age: row.age,
      birthYear: row.birth_year,
      gender: row.gender,
      activityLevel: row.activity_level,
      goal: row.goal,
      tdee: row.tdee,
      targetCalories: row.target_calories,
      onboardingCompleted: row.onboarding_completed === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  createOrUpdateUser(profile: UserProfile): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO users (
        whatsapp_id, name, height, weight, target_weight, age, birth_year, gender,
        activity_level, goal, tdee, target_calories, onboarding_completed,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      profile.whatsappId,
      profile.name,
      profile.height,
      profile.weight,
      profile.targetWeight,
      profile.age || null,
      profile.birthYear || null,
      profile.gender || null,
      profile.activityLevel,
      profile.goal,
      profile.tdee || null,
      profile.targetCalories || null,
      profile.onboardingCompleted ? 1 : 0,
      profile.createdAt,
      profile.updatedAt
    );
  }

  // Food entry methods
  addFoodEntry(entry: FoodEntry): number {
    const stmt = this.db.prepare(`
      INSERT INTO food_entries (
        whatsapp_id, date, timestamp, type, description,
        calories, protein, carbs, fats
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      entry.whatsappId,
      entry.date,
      entry.timestamp,
      entry.type,
      entry.description,
      entry.calories,
      entry.protein || null,
      entry.carbs || null,
      entry.fats || null
    );

    return result.lastInsertRowid as number;
  }

  /**
   * Check if a food entry with the same description already exists today.
   * Case-insensitive to catch duplicates like "yogurt" vs "Yogurt".
   */
  foodEntryExists(whatsappId: string, date: string, description: string): boolean {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as c FROM food_entries
      WHERE whatsapp_id = ? AND date = ? AND LOWER(description) = LOWER(?)
    `);
    const row = stmt.get(whatsappId, date, description.trim()) as any;
    return (row?.c || 0) > 0;
  }

  /**
   * Check if an activity with the same description already exists today.
   */
  activityExists(whatsappId: string, date: string, description: string): boolean {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as c FROM activities
      WHERE whatsapp_id = ? AND date = ? AND LOWER(description) = LOWER(?)
    `);
    const row = stmt.get(whatsappId, date, description.trim()) as any;
    return (row?.c || 0) > 0;
  }

  getFoodEntriesByDate(whatsappId: string, date: string): FoodEntry[] {
    const stmt = this.db.prepare(`
      SELECT * FROM food_entries 
      WHERE whatsapp_id = ? AND date = ?
      ORDER BY timestamp ASC
    `);

    const rows = stmt.all(whatsappId, date) as any[];
    return rows.map(row => ({
      id: row.id,
      whatsappId: row.whatsapp_id,
      date: row.date,
      timestamp: row.timestamp,
      type: row.type,
      description: row.description,
      calories: row.calories,
      protein: row.protein,
      carbs: row.carbs,
      fats: row.fats,
    }));
  }

  // Activity methods
  addActivity(entry: ActivityEntry): number {
    const stmt = this.db.prepare(`
      INSERT INTO activities (
        whatsapp_id, date, timestamp, description, duration, calories_burned
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      entry.whatsappId,
      entry.date,
      entry.timestamp,
      entry.description,
      entry.duration || null,
      entry.caloriesBurned || null
    );

    return result.lastInsertRowid as number;
  }

  getActivitiesByDate(whatsappId: string, date: string): ActivityEntry[] {
    const stmt = this.db.prepare(`
      SELECT * FROM activities 
      WHERE whatsapp_id = ? AND date = ?
      ORDER BY timestamp ASC
    `);

    const rows = stmt.all(whatsappId, date) as any[];
    return rows.map(row => ({
      id: row.id,
      whatsappId: row.whatsapp_id,
      date: row.date,
      timestamp: row.timestamp,
      description: row.description,
      duration: row.duration,
      caloriesBurned: row.calories_burned,
    }));
  }

  // Weight log methods
  addWeightLog(log: WeightLog): number {
    const stmt = this.db.prepare(`
      INSERT INTO weight_logs (whatsapp_id, date, weight, notes)
      VALUES (?, ?, ?, ?)
    `);

    const result = stmt.run(
      log.whatsappId,
      log.date,
      log.weight,
      log.notes || null
    );

    return result.lastInsertRowid as number;
  }

  getLatestWeight(whatsappId: string): WeightLog | null {
    const stmt = this.db.prepare(`
      SELECT * FROM weight_logs 
      WHERE whatsapp_id = ?
      ORDER BY date DESC
      LIMIT 1
    `);

    const row = stmt.get(whatsappId) as any;
    if (!row) return null;

    return {
      id: row.id,
      whatsappId: row.whatsapp_id,
      date: row.date,
      weight: row.weight,
      notes: row.notes,
    };
  }

  getWeightHistory(whatsappId: string, limit: number = 30): WeightLog[] {
    const stmt = this.db.prepare(`
      SELECT * FROM weight_logs 
      WHERE whatsapp_id = ?
      ORDER BY date DESC
      LIMIT ?
    `);

    const rows = stmt.all(whatsappId, limit) as any[];
    return rows.map(row => ({
      id: row.id,
      whatsappId: row.whatsapp_id,
      date: row.date,
      weight: row.weight,
      notes: row.notes,
    }));
  }

  // Daily summary
  getDailySummary(whatsappId: string, date: string): DailySummary {
    const foods = this.getFoodEntriesByDate(whatsappId, date);
    const activities = this.getActivitiesByDate(whatsappId, date);

    const totalCalories = foods.reduce((sum, f) => sum + f.calories, 0);
    const totalProtein = foods.reduce((sum, f) => sum + (f.protein || 0), 0);
    const totalCarbs = foods.reduce((sum, f) => sum + (f.carbs || 0), 0);
    const totalFats = foods.reduce((sum, f) => sum + (f.fats || 0), 0);
    const caloriesBurned = activities.reduce((sum, a) => sum + (a.caloriesBurned || 0), 0);

    return {
      date,
      totalCalories,
      totalProtein,
      totalCarbs,
      totalFats,
      foodCount: foods.length,
      activityCount: activities.length,
      caloriesBurned,
    };
  }

  // ---- Panel methods ----

  /**
   * Update specific fields of a user. Recalculates TDEE & target calories
   * when weight/height/age/gender/activity_level/goal change.
   */
  updateUser(whatsappId: string, updates: Partial<UserProfile>): UserProfile | null {
    const current = this.getUserProfile(whatsappId);
    if (!current) return null;

    const now = getNowWIB();
    const sets: string[] = ['updated_at = ?'];
    const params: any[] = [now];

    const numeric = (v: any): number | null => (typeof v === 'number' && !isNaN(v) ? v : null);
    const str = (v: any): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

    const name = str(updates.name);
    if (name) { sets.push('name = ?'); params.push(name); }

    const height = numeric(updates.height);
    if (height !== null) { sets.push('height = ?'); params.push(height); }

    const weight = numeric(updates.weight);
    if (weight !== null) { sets.push('weight = ?'); params.push(weight); }

    const targetWeight = numeric(updates.targetWeight);
    if (targetWeight !== null) { sets.push('target_weight = ?'); params.push(targetWeight); }

    const age = numeric(updates.age);
    if (age !== null) { sets.push('age = ?'); params.push(age); }

    const birthYear = numeric(updates.birthYear);
    if (birthYear !== null) { sets.push('birth_year = ?'); params.push(birthYear); }

    const gender = str(updates.gender);
    if (gender) { sets.push('gender = ?'); params.push(gender); }

    const activityLevel = str(updates.activityLevel);
    if (activityLevel) { sets.push('activity_level = ?'); params.push(activityLevel); }

    const goal = str(updates.goal);
    if (goal) { sets.push('goal = ?'); params.push(goal); }

    if (sets.length === 1) return this.getUserProfile(whatsappId); // nothing to update

    this.db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE whatsapp_id = ?`).run(...params, whatsappId);

    // Recalculate TDEE & target calories if body/goal changed
    const fresh = this.getUserProfile(whatsappId)!;
    if (weight !== null || height !== null || age !== null || gender || activityLevel || goal) {
      const tdee = this.calculateTDEE(
        fresh.weight,
        fresh.height,
        fresh.age || 30,
        fresh.gender || 'male',
        fresh.activityLevel
      );
      let targetCalories = tdee;
      if (fresh.goal === 'lose') targetCalories = tdee - 500;
      else if (fresh.goal === 'gain') targetCalories = tdee + 300;

      this.db.prepare('UPDATE users SET tdee = ?, target_calories = ? WHERE whatsapp_id = ?')
        .run(tdee, targetCalories, whatsappId);
    }

    return this.getUserProfile(whatsappId);
  }

  private calculateTDEE(weight: number, height: number, age: number, gender: string, activityLevel: string): number {
    let bmr: number;
    if (gender === 'male') {
      bmr = 10 * weight + 6.25 * height - 5 * age + 5;
    } else {
      bmr = 10 * weight + 6.25 * height - 5 * age - 161;
    }
    const activityMultipliers: Record<string, number> = {
      sedentary: 1.2,
      light: 1.375,
      moderate: 1.55,
      active: 1.725,
      very_active: 1.9,
    };
    const multiplier = activityMultipliers[activityLevel] || 1.2;
    return Math.round(bmr * multiplier);
  }

  getAllUsers(): UserProfile[] {
    const stmt = this.db.prepare(`
      SELECT * FROM users ORDER BY created_at DESC
    `);
    const rows = stmt.all() as any[];
    return rows.map((row) => ({
      whatsappId: row.whatsapp_id,
      name: row.name,
      height: row.height,
      weight: row.weight,
      targetWeight: row.target_weight,
      age: row.age,
      birthYear: row.birth_year,
      gender: row.gender,
      activityLevel: row.activity_level,
      goal: row.goal,
      tdee: row.tdee,
      targetCalories: row.target_calories,
      onboardingCompleted: row.onboarding_completed === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  deleteUser(whatsappId: string): void {
    this.db.prepare('DELETE FROM food_entries WHERE whatsapp_id = ?').run(whatsappId);
    this.db.prepare('DELETE FROM activities WHERE whatsapp_id = ?').run(whatsappId);
    this.db.prepare('DELETE FROM weight_logs WHERE whatsapp_id = ?').run(whatsappId);
    this.db.prepare('DELETE FROM users WHERE whatsapp_id = ?').run(whatsappId);
  }

  resetOnboarding(whatsappId: string): void {
    this.db.prepare('UPDATE users SET onboarding_completed = 0 WHERE whatsapp_id = ?').run(whatsappId);
  }

  getAllFoodEntries(whatsappId?: string, date?: string): FoodEntry[] {
    let sql = `SELECT * FROM food_entries`;
    const where: string[] = [];
    const params: any[] = [];
    if (whatsappId) { where.push('whatsapp_id = ?'); params.push(whatsappId); }
    if (date) { where.push('date = ?'); params.push(date); }
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY timestamp DESC LIMIT 500';

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((row) => ({
      id: row.id,
      whatsappId: row.whatsapp_id,
      date: row.date,
      timestamp: row.timestamp,
      type: row.type,
      description: row.description,
      calories: row.calories,
      protein: row.protein,
      carbs: row.carbs,
      fats: row.fats,
    }));
  }

  getAllActivities(whatsappId?: string, date?: string): ActivityEntry[] {
    let sql = `SELECT * FROM activities`;
    const where: string[] = [];
    const params: any[] = [];
    if (whatsappId) { where.push('whatsapp_id = ?'); params.push(whatsappId); }
    if (date) { where.push('date = ?'); params.push(date); }
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY timestamp DESC LIMIT 500';

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((row) => ({
      id: row.id,
      whatsappId: row.whatsapp_id,
      date: row.date,
      timestamp: row.timestamp,
      description: row.description,
      duration: row.duration,
      caloriesBurned: row.calories_burned,
    }));
  }

  getAllWeightLogs(whatsappId?: string): WeightLog[] {
    let sql = `SELECT * FROM weight_logs`;
    const where: string[] = [];
    const params: any[] = [];
    if (whatsappId) { where.push('whatsapp_id = ?'); params.push(whatsappId); }
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY date DESC LIMIT 500';

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((row) => ({
      id: row.id,
      whatsappId: row.whatsapp_id,
      date: row.date,
      weight: row.weight,
      notes: row.notes,
    }));
  }

  getStats(): { userCount: number; foodCount: number; activityCount: number; weightCount: number } {
    const userCount = (this.db.prepare('SELECT COUNT(*) as c FROM users').get() as any).c;
    const foodCount = (this.db.prepare('SELECT COUNT(*) as c FROM food_entries').get() as any).c;
    const activityCount = (this.db.prepare('SELECT COUNT(*) as c FROM activities').get() as any).c;
    const weightCount = (this.db.prepare('SELECT COUNT(*) as c FROM weight_logs').get() as any).c;
    return { userCount, foodCount, activityCount, weightCount };
  }

  /** Delete a single food entry by id */
  deleteFoodEntry(id: number): void {
    this.db.prepare('DELETE FROM food_entries WHERE id = ?').run(id);
  }

  /** Delete a single activity entry by id */
  deleteActivity(id: number): void {
    this.db.prepare('DELETE FROM activities WHERE id = ?').run(id);
  }

  /** Delete a single weight log by id */
  deleteWeightLog(id: number): void {
    this.db.prepare('DELETE FROM weight_logs WHERE id = ?').run(id);
  }

  close(): void {
    this.db.close();
  }
}
