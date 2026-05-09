import { uniqueStrings } from "./utils.js";

export const TRAIT_ALIASES: Record<string, string[]> = {
  秩序善: ["alignmentLawful", "alignmentGood"],
  中立善: ["alignmentNeutral", "alignmentGood"],
  混沌善: ["alignmentChaotic", "alignmentGood"],
  秩序恶: ["alignmentLawful", "alignmentEvil"],
  秩序惡: ["alignmentLawful", "alignmentEvil"],
  中立恶: ["alignmentNeutral", "alignmentEvil"],
  中立惡: ["alignmentNeutral", "alignmentEvil"],
  混沌恶: ["alignmentChaotic", "alignmentEvil"],
  混沌惡: ["alignmentChaotic", "alignmentEvil"],
  混沌中庸: ["alignmentChaotic", "alignmentBalanced"],
  中立中庸: ["alignmentNeutral", "alignmentBalanced"],
  秩序中庸: ["alignmentLawful", "alignmentBalanced"],
  秩序: ["alignmentLawful"],
  混沌: ["alignmentChaotic"],
  中立: ["alignmentNeutral"],
  善: ["alignmentGood"],
  恶: ["alignmentEvil"],
  惡: ["alignmentEvil"],
  中庸: ["alignmentBalanced"],
  狂性: ["alignmentMadness"],
  夏: ["alignmentSummer"],
  夏日: ["alignmentSummer"],
  人: ["attribute:human"],
  天: ["attribute:sky"],
  地: ["attribute:earth"],
  星: ["attribute:star"],
  兽: ["attribute:beast"],
  獸: ["attribute:beast"],
  女性从者: ["gender:female"],
  女性: ["gender:female"],
  女从者: ["gender:female"],
  女英灵: ["gender:female"],
  女英靈: ["gender:female"],
  female: ["gender:female"],
  Female: ["gender:female"],
  男性从者: ["gender:male"],
  男性: ["gender:male"],
  男从者: ["gender:male"],
  男英灵: ["gender:male"],
  男英靈: ["gender:male"],
  male: ["gender:male"],
  Male: ["gender:male"],
  性别不明: ["gender:unknown"],
  性別不明: ["gender:unknown"],
  unknownGender: ["gender:unknown"],
  Saber: ["class:saber"],
  剑阶: ["class:saber"],
  劍階: ["class:saber"],
  Archer: ["class:archer"],
  弓阶: ["class:archer"],
  Lancer: ["class:lancer"],
  枪阶: ["class:lancer"],
  Rider: ["class:rider"],
  骑阶: ["class:rider"],
  Caster: ["class:caster"],
  术阶: ["class:caster"],
  Assassin: ["class:assassin"],
  杀阶: ["class:assassin"],
  Berserker: ["class:berserker"],
  狂阶: ["class:berserker"],
  狂階: ["class:berserker"],
  Ruler: ["class:ruler"],
  裁定者: ["class:ruler"],
  Avenger: ["class:avenger"],
  复仇者: ["class:avenger"],
  Alterego: ["class:alterEgo"],
  AlterEgo: ["class:alterEgo"],
  MoonCancer: ["class:moonCancer"],
  Foreigner: ["class:foreigner"],
  Pretender: ["class:pretender"],
  Beast: ["class:beast"],
};

export const EFFECT_ALIASES: Record<string, string[]> = {
  无敌贯通: ["pierceInvincible", "无敌贯通", "buffInvinciblePierce"],
  無敵貫通: ["pierceInvincible", "無敵貫通", "buffInvinciblePierce"],
  贯通无敌: ["pierceInvincible", "无敌贯通"],
  无视防御: ["pierceDefence", "无视防御"],
  無視防禦: ["pierceDefence", "無視防禦"],
  回避: ["avoidance", "回避"],
  无敌: ["invincible", "无敌"],
  無敵: ["invincible", "無敵"],
  肃正防御: ["specialInvincible", "肃正防御"],
  弱化解除: ["avoidRemove", "弱化解除", "removeState"],
  强化解除: ["buffRemove", "强化解除", "removeBuff"],
  NP充能: ["gainNp", "NP增加", "NP增加"],
  np充能: ["gainNp", "NP增加"],
  充能: ["gainNp", "NP增加"],
  自充: ["gainNp", "NP增加"],
  特攻: ["upSpecial", "specialAttack", "特攻", "supereffective"],
  神性特攻: ["specialAttack:divine", "对神性特攻", "神性特攻"],
  神性特效: ["specialAttack:divine", "对神性特攻", "神性特效"],
  对神性特攻: ["specialAttack:divine", "对神性特攻"],
  對神性特攻: ["specialAttack:divine", "对神性特攻"],
  蓝卡宝具: ["npCard:arts", "蓝卡宝具"],
  藍卡寶具: ["npCard:arts", "蓝卡宝具"],
  Arts宝具: ["npCard:arts", "Arts宝具"],
  arts宝具: ["npCard:arts", "Arts宝具"],
  红卡宝具: ["npCard:buster", "红卡宝具"],
  紅卡寶具: ["npCard:buster", "红卡宝具"],
  Buster宝具: ["npCard:buster", "Buster宝具"],
  buster宝具: ["npCard:buster", "Buster宝具"],
  绿卡宝具: ["npCard:quick", "绿卡宝具"],
  綠卡寶具: ["npCard:quick", "绿卡宝具"],
  Quick宝具: ["npCard:quick", "Quick宝具"],
  quick宝具: ["npCard:quick", "Quick宝具"],
  宝具威力: ["upNpdamage", "宝具威力提升"],
  攻击力提升: ["upAttack", "攻击力提升"],
  色卡提升: ["upCommandall", "upCommandarts", "upCommandbuster", "upCommandquick"],
};

export function resolveTraitTerms(input: string | string[]): string[] {
  const rawTerms = Array.isArray(input)
    ? input
    : input
        .split(/[,\s+，、]+/)
        .map((term) => term.trim())
        .filter(Boolean);
  const resolved: string[] = [];
  for (const term of rawTerms) {
    resolved.push(...(TRAIT_ALIASES[term] ?? [term]));
  }
  return uniqueStrings(resolved);
}

export function resolveEffectTerms(input: string | string[]): string[] {
  const rawTerms = Array.isArray(input)
    ? input
    : input
        .split(/[,\s+，、]+/)
        .map((term) => term.trim())
        .filter(Boolean);
  const resolved: string[] = [];
  for (const term of rawTerms) {
    resolved.push(...(EFFECT_ALIASES[term] ?? [term]));
  }
  return uniqueStrings(resolved);
}

export function extractTraitTerms(text: string): string[] {
  return extractAliasedTerms(text, TRAIT_ALIASES);
}

export function extractEffectTerms(text: string): string[] {
  return extractAliasedTerms(text, EFFECT_ALIASES);
}

export function extractEffectTermGroups(text: string): string[][] {
  const groups: string[][] = [];
  const normalized = text.replace(/\s+/g, "");
  const keys = Object.keys(EFFECT_ALIASES).sort((a, b) => b.length - a.length);
  const matchedKeys: string[] = [];
  for (const key of keys) {
    const compactKey = key.replace(/\s+/g, "");
    if (!normalized.includes(compactKey)) continue;
    if (matchedKeys.some((existing) => existing.includes(key) || key.includes(existing))) continue;
    matchedKeys.push(key);
    groups.push(uniqueStrings(EFFECT_ALIASES[key] ?? [key]));
  }
  return groups;
}

export function describeTerm(term: string): string {
  const labels: Record<string, string> = {
    alignmentLawful: "秩序",
    alignmentChaotic: "混沌",
    alignmentNeutral: "中立",
    alignmentGood: "善",
    alignmentEvil: "恶",
    alignmentBalanced: "中庸",
    alignmentMadness: "狂",
    alignmentSummer: "夏",
    "class:saber": "剑阶",
    "class:archer": "弓阶",
    "class:lancer": "枪阶",
    "class:rider": "骑阶",
    "class:caster": "术阶",
    "class:assassin": "杀阶",
    "class:berserker": "狂阶",
    "class:ruler": "Ruler",
    "class:avenger": "Avenger",
    "class:alterEgo": "Alter Ego",
    "class:moonCancer": "Moon Cancer",
    "class:foreigner": "Foreigner",
    "class:pretender": "Pretender",
    "attribute:human": "人阵营",
    "attribute:sky": "天阵营",
    "attribute:earth": "地阵营",
    "attribute:star": "星阵营",
    "attribute:beast": "兽阵营",
    "gender:female": "女性",
    "gender:male": "男性",
    "gender:unknown": "性别不明",
    "npCard:arts": "蓝卡宝具",
    "npCard:buster": "红卡宝具",
    "npCard:quick": "绿卡宝具",
    "specialAttack:divine": "神性特攻",
    "specialAttack:alignmentChaotic": "混沌特攻",
    "specialAttack:demonic": "魔性特攻",
    "specialAttack:dragon": "龙特攻",
    "specialAttack:king": "王特攻",
    "specialAttack:humanoid": "人型特攻",
    "specialAttack:threatToHumanity": "人类的威胁特攻",
    pierceInvincible: "无敌贯通",
    pierceDefence: "无视防御",
  };
  return labels[term] ?? term;
}

function extractAliasedTerms(text: string, aliases: Record<string, string[]>): string[] {
  const matched: string[] = [];
  const normalized = text.replace(/\s+/g, "");
  const keys = Object.keys(aliases).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    const compactKey = key.replace(/\s+/g, "");
    if (normalized.includes(compactKey)) {
      matched.push(...(aliases[key] ?? []));
    }
  }
  return uniqueStrings(matched);
}
