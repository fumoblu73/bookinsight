export type ComplianceCategory = 'SALUTE' | 'FINANZA' | 'NUTRIZIONE' | 'LEGALE' | 'DEFAULT'
export type ComplianceRisk = 'alto' | 'medio' | 'basso'

const CATEGORY_TRIGGERS: Record<ComplianceCategory, string[]> = {
  SALUTE: [
    'health', 'medical', 'pain', 'disease', 'cure', 'symptom',
    'fitness', 'exercise', 'diet', 'weight', 'yoga', 'tai chi',
    'wellness', 'therapy', 'anxiety', 'depression', 'stress',
    'sleep', 'meditation', 'mindfulness',
  ],
  FINANZA: [
    'invest', 'money', 'trading', 'stock', 'crypto', 'income',
    'profit', 'wealth', 'budget', 'finance', 'passive income',
    'real estate', 'retirement', 'saving',
  ],
  NUTRIZIONE: [
    'food', 'recipe', 'cook', 'eat', 'nutrition', 'calorie',
    'meal', 'diet', 'mediterranean', 'keto', 'vegan', 'paleo',
    'intermittent fasting', 'gluten', 'protein',
  ],
  LEGALE: [
    'law', 'legal', 'tax', 'contract', 'business', 'llc',
    'attorney', 'court', 'rights', 'compliance', 'regulation',
  ],
  DEFAULT: [],
}

// Priorità: SALUTE > NUTRIZIONE > FINANZA > LEGALE > DEFAULT
const PRIORITY: ComplianceCategory[] = ['SALUTE', 'NUTRIZIONE', 'FINANZA', 'LEGALE', 'DEFAULT']

const RISK_LEVEL: Record<ComplianceCategory, ComplianceRisk> = {
  SALUTE:     'alto',
  NUTRIZIONE: 'medio',
  FINANZA:    'alto',
  LEGALE:     'medio',
  DEFAULT:    'basso',
}

export function detectComplianceCategory(keyword: string): ComplianceCategory {
  const lower = keyword.toLowerCase()

  for (const category of PRIORITY) {
    if (category === 'DEFAULT') return 'DEFAULT'
    const triggers = CATEGORY_TRIGGERS[category]
    if (triggers.some(t => lower.includes(t))) return category
  }

  return 'DEFAULT'
}

export function getComplianceRisk(category: ComplianceCategory): ComplianceRisk {
  return RISK_LEVEL[category]
}

export function getComplianceMultiplier(risk: ComplianceRisk): number {
  if (risk === 'basso')  return 1.00
  if (risk === 'medio')  return 0.85
  return 0.65  // alto
}
