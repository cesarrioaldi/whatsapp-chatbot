import { DatabaseService } from './database';
import { UserProfile } from './types';
import { getTodayWIB, getNowWIB } from './config';

export class OnboardingService {
  private db: DatabaseService;
  private onboardingState: Map<string, Partial<UserProfile>> = new Map();

  constructor(db: DatabaseService) {
    this.db = db;
  }

  isOnboarded(whatsappId: string): boolean {
    const user = this.db.getUserProfile(whatsappId);
    return user?.onboardingCompleted || false;
  }

  getOnboardingState(whatsappId: string): Partial<UserProfile> | null {
    return this.onboardingState.get(whatsappId) || null;
  }

  startOnboarding(whatsappId: string): void {
    this.onboardingState.set(whatsappId, { whatsappId });
  }

  updateOnboardingState(whatsappId: string, data: Partial<UserProfile>): void {
    const current = this.onboardingState.get(whatsappId) || { whatsappId };
    this.onboardingState.set(whatsappId, { ...current, ...data });
  }

  clearOnboardingState(whatsappId: string): void {
    this.onboardingState.delete(whatsappId);
  }

  completeOnboarding(whatsappId: string): UserProfile | null {
    const state = this.onboardingState.get(whatsappId);
    
    if (!state || !this.isOnboardingComplete(state)) {
      return null;
    }

    // Calculate TDEE and target calories
    const tdee = this.calculateTDEE(
      state.weight!,
      state.height!,
      state.age || 30,
      state.gender || 'male',
      state.activityLevel!
    );

    let targetCalories = tdee;
    if (state.goal === 'lose') {
      targetCalories = tdee - 500; // 500 calorie deficit
    } else if (state.goal === 'gain') {
      targetCalories = tdee + 300; // 300 calorie surplus
    }

    const now = getNowWIB();
    const profile: UserProfile = {
      whatsappId: state.whatsappId!,
      name: state.name!,
      height: state.height!,
      weight: state.weight!,
      targetWeight: state.targetWeight!,
      age: state.age,
      birthYear: state.birthYear,
      gender: state.gender,
      activityLevel: state.activityLevel!,
      goal: state.goal!,
      tdee,
      targetCalories,
      onboardingCompleted: true,
      createdAt: now,
      updatedAt: now,
    };

    this.db.createOrUpdateUser(profile);
    this.onboardingState.delete(whatsappId);
    
    // Log initial weight
    this.db.addWeightLog({
      whatsappId,
      date: getTodayWIB(),
      weight: profile.weight,
      notes: 'Initial weight',
    });

    return profile;
  }

  private isOnboardingComplete(state: Partial<UserProfile>): boolean {
    return !!(
      state.name &&
      state.height &&
      state.weight &&
      state.targetWeight &&
      state.activityLevel &&
      state.goal &&
      state.age
    );
  }

  private calculateTDEE(
    weight: number,
    height: number,
    age: number,
    gender: string,
    activityLevel: string
  ): number {
    // Mifflin-St Jeor Equation for BMR
    let bmr: number;
    if (gender === 'male') {
      bmr = 10 * weight + 6.25 * height - 5 * age + 5;
    } else {
      bmr = 10 * weight + 6.25 * height - 5 * age - 161;
    }

    // Activity multipliers
    const activityMultipliers = {
      sedentary: 1.2,
      light: 1.375,
      moderate: 1.55,
      active: 1.725,
      very_active: 1.9,
    };

    const multiplier = activityMultipliers[activityLevel as keyof typeof activityMultipliers] || 1.2;
    return Math.round(bmr * multiplier);
  }

  getOnboardingPrompt(): string {
    return `
🌟 Selamat datang! Aku adalah Personal Trainer AI yang akan bantu kamu mencapai target diet 💪

Aku bisa:
✅ Tracking makanan & kalori harian
✅ Hitung kebutuhan kalori kamu (TDEE)
✅ Monitoring progress berat badan
✅ Kasih saran diet & nutrisi personal

Tapi sebelum mulai, aku perlu kenalan dulu sama kamu biar bisa kasih program yang sesuai!

Pertama, siapa nama kamu? 😊

(Kalau ada pertanyaan, langsung tanya aja ya!)
    `.trim();
  }

  getNextOnboardingQuestion(state: Partial<UserProfile>): string {
    if (!state.name) {
      return 'Siapa nama kamu? 😊';
    }
    if (!state.gender) {
      return `Halo ${state.name}! Kamu cowok atau cewek? (jawab "cowok" / "cewek")`;
    }
    if (!state.height) {
      return `${state.gender === 'female' ? 'Baik kak' : 'Baik bro'}! Tinggi badan kamu berapa cm?`;
    }
    if (!state.weight) {
      return 'Berat badan kamu sekarang berapa kg?';
    }
    if (!state.targetWeight) {
      return 'Target berat badan yang kamu mau berapa kg?';
    }
    if (!state.goal) {
      return 'Goal kamu apa nih? Tulis salah satu:\n- "turun" (untuk nurunin berat)\n- "naik" (untuk naikin berat)\n- "maintain" (untuk maintain berat)';
    }
    if (!state.activityLevel) {
      return 'Aktivitas fisik kamu sehari-hari gimana? Pilih salah satu:\n- "santai" (jarang gerak, banyak duduk)\n- "ringan" (jalan-jalan, aktivitas ringan)\n- "sedang" (olahraga 3-5x seminggu)\n- "aktif" (olahraga intensif hampir tiap hari)\n- "sangat aktif" (atlet/kerja fisik berat)';
    }
    if (!state.age) {
      return 'Tahun lahir kamu berapa? (contoh: 1998) — biar aku hitung umur otomatis 🎂';
    }
    
    return '';
  }

  parseOnboardingAnswer(
    state: Partial<UserProfile>,
    answer: string
  ): { success: boolean; error?: string; data?: Partial<UserProfile> } {
    const lowerAnswer = answer.toLowerCase().trim();

    if (!state.name) {
      // Detect if user is asking questions instead of giving name
      const questionWords = ['siapa', 'apa', 'kenapa', 'gimana', 'bagaimana', 'what', 'who', 'why', 'how'];
      const isQuestion = questionWords.some(q => lowerAnswer.includes(q)) || 
                         lowerAnswer.includes('?');
      
      if (isQuestion) {
        return { 
          success: false, 
          error: `Aku adalah Personal Trainer AI untuk diet & nutrisi! 💪\n\nAku bisa bantu kamu:\n- Tracking makanan & kalori\n- Hitung kebutuhan kalori harian\n- Monitor progress berat badan\n- Kasih saran diet personal\n\nYuk mulai! Siapa nama kamu? 😊` 
        };
      }
      
      // Basic name validation
      if (answer.length < 2 || answer.length > 50) {
        return { success: false, error: 'Nama harus 2-50 karakter ya!' };
      }
      
      return { success: true, data: { name: answer.trim() } };
    }

    if (!state.gender) {
      let gender: 'male' | 'female' | undefined;
      if (lowerAnswer.includes('cowok') || lowerAnswer.includes('male') || lowerAnswer.includes('pria') || lowerAnswer.includes('laki')) {
        gender = 'male';
      } else if (lowerAnswer.includes('cewek') || lowerAnswer.includes('female') || lowerAnswer.includes('wanita') || lowerAnswer.includes('perempuan')) {
        gender = 'female';
      }
      if (!gender) {
        return { success: false, error: 'Tulis "cowok" atau "cewek" ya!' };
      }
      return { success: true, data: { gender } };
    }

    if (!state.height) {
      const height = parseFloat(answer);
      if (isNaN(height) || height < 100 || height > 250) {
        return { success: false, error: 'Tinggi badan harus angka antara 100-250 cm ya!' };
      }
      return { success: true, data: { height } };
    }

    if (!state.weight) {
      const weight = parseFloat(answer);
      if (isNaN(weight) || weight < 30 || weight > 300) {
        return { success: false, error: 'Berat badan harus angka antara 30-300 kg ya!' };
      }
      return { success: true, data: { weight } };
    }

    if (!state.targetWeight) {
      const targetWeight = parseFloat(answer);
      if (isNaN(targetWeight) || targetWeight < 30 || targetWeight > 300) {
        return { success: false, error: 'Target berat badan harus angka antara 30-300 kg ya!' };
      }
      return { success: true, data: { targetWeight } };
    }

    if (!state.goal) {
      let goal: 'lose' | 'gain' | 'maintain' | undefined;
      if (lowerAnswer.includes('turun') || lowerAnswer.includes('lose')) {
        goal = 'lose';
      } else if (lowerAnswer.includes('naik') || lowerAnswer.includes('gain')) {
        goal = 'gain';
      } else if (lowerAnswer.includes('maintain') || lowerAnswer.includes('jaga')) {
        goal = 'maintain';
      }
      
      if (!goal) {
        return { success: false, error: 'Tulis "turun", "naik", atau "maintain" ya!' };
      }
      return { success: true, data: { goal } };
    }

    if (!state.activityLevel) {
      let activityLevel: UserProfile['activityLevel'] | undefined;
      if (lowerAnswer.includes('santai') || lowerAnswer.includes('sedentary')) {
        activityLevel = 'sedentary';
      } else if (lowerAnswer.includes('ringan') || lowerAnswer.includes('light')) {
        activityLevel = 'light';
      } else if (lowerAnswer.includes('sedang') || lowerAnswer.includes('moderate')) {
        activityLevel = 'moderate';
      } else if (lowerAnswer.includes('sangat aktif') || lowerAnswer.includes('very')) {
        activityLevel = 'very_active';
      } else if (lowerAnswer.includes('aktif') || lowerAnswer.includes('active')) {
        activityLevel = 'active';
      }

      if (!activityLevel) {
        return { 
          success: false, 
          error: 'Pilih salah satu: santai, ringan, sedang, aktif, atau sangat aktif ya!' 
        };
      }
      return { success: true, data: { activityLevel } };
    }

    if (!state.age) {
      const birthYear = parseInt(answer);
      const currentYear = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', year: 'numeric' }).format(new Date());
      const yearNum = parseInt(currentYear);
      if (isNaN(birthYear) || birthYear < 1900 || birthYear > yearNum) {
        return { success: false, error: 'Tahun lahir harus antara 1900 sampai ' + yearNum + ' ya!' };
      }
      const age = yearNum - birthYear;
      return { success: true, data: { birthYear, age } };
    }

    return { success: false, error: 'Unexpected state' };
  }

  getOnboardingCompletionMessage(profile: UserProfile): string {
    const goalText = 
      profile.goal === 'lose' ? `turunin dari ${profile.weight}kg ke ${profile.targetWeight}kg` :
      profile.goal === 'gain' ? `naikin dari ${profile.weight}kg ke ${profile.targetWeight}kg` :
      `maintain di ${profile.weight}kg`;

    return `
✅ Onboarding selesai! Welcome, ${profile.name}! 🎉

📊 Profile kamu:
• Gender: ${profile.gender === 'female' ? 'Perempuan' : 'Laki-laki'}
• Umur: ${profile.age} tahun (lahir ${profile.birthYear || '-'})
• Tinggi: ${profile.height}cm
• Berat sekarang: ${profile.weight}kg
• Target: ${profile.targetWeight}kg
• Goal: ${goalText}
• Aktivitas: ${this.getActivityLevelText(profile.activityLevel)}

🔥 Kalori harian kamu:
• TDEE (maintenance): ~${profile.tdee} kalori
• Target diet: ~${profile.targetCalories} kalori/hari

Aku siap bantu kamu! Mulai sekarang kamu bisa:
📝 Log makanan & minuman
💪 Log aktivitas olahraga
⚖️ Update berat badan
📊 Lihat progress harian

Yuk mulai! Ada makan apa hari ini? 😊
    `.trim();
  }

  private getActivityLevelText(level: string): string {
    const texts = {
      sedentary: 'Santai (jarang gerak)',
      light: 'Ringan (aktivitas ringan)',
      moderate: 'Sedang (olahraga 3-5x/minggu)',
      active: 'Aktif (olahraga hampir tiap hari)',
      very_active: 'Sangat Aktif (atlet/kerja berat)',
    };
    return texts[level as keyof typeof texts] || level;
  }
}
