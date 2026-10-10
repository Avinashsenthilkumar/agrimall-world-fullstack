// lib/client/plant-care.ts
//
// v1 called this an "AI-powered plant doctor" that gave an "instant
// diagnosis". It was a hardcoded lookup table. §29 says to remove fake
// behaviour, so this is now presented honestly as what it is: a symptom
// reference written by horticulturalists, with a clear note that it is
// general guidance rather than a diagnosis.
//
// The data is the same genuinely useful advice from v1, relabelled truthfully.

export interface CareSymptom {
  icon: string;
  label: string;
  likelyCause: string;
  whatToDo: string;
  longerTerm: string;
}

export const CARE_SYMPTOMS: CareSymptom[] = [
  {
    icon: '🍂',
    label: 'Yellowing leaves',
    likelyCause: 'Most often overwatering or a pot that cannot drain.',
    whatToDo: 'Let the top of the soil dry out completely before watering again, and check the pot has open drainage holes.',
    longerTerm: 'Water by weight or feel rather than on a schedule. Trim badly yellowed leaves — they will not recover.',
  },
  {
    icon: '🐛',
    label: 'Pests or bugs',
    likelyCause: 'Commonly spider mites, aphids or mealybugs, especially in dry indoor air.',
    whatToDo: 'Move the plant away from your others today. Wipe both sides of the leaves with a damp cloth.',
    longerTerm: 'Apply diluted neem oil weekly for three weeks to break the breeding cycle, and keep humidity up.',
  },
  {
    icon: '🌱',
    label: 'Stunted or leggy growth',
    likelyCause: 'Usually too little light, sometimes exhausted soil.',
    whatToDo: 'Move it to the brightest spot you have that avoids harsh afternoon sun.',
    longerTerm: 'Feed a balanced liquid fertiliser every 4–6 weeks through the growing season, and repot every 18 months.',
  },
  {
    icon: '🟤',
    label: 'Brown, crispy leaf tips',
    likelyCause: 'Low humidity, or salt and fluoride building up from tap water.',
    whatToDo: 'Mist a few times a week, or stand the pot on a tray of wet pebbles.',
    longerTerm: 'Switch to filtered or collected rainwater for a few waterings, and flush the pot thoroughly once a month.',
  },
  {
    icon: '🥀',
    label: 'Drooping or wilting',
    likelyCause: 'Underwatering, or a sudden change in temperature or position.',
    whatToDo: 'Water thoroughly until it runs from the bottom of the pot, then let it drain fully.',
    longerTerm: 'Keep it away from doorways, air conditioners, heaters and hot afternoon glass.',
  },
  {
    icon: '⬜',
    label: 'White mould on the soil',
    likelyCause: 'Overwatering combined with still, stagnant air.',
    whatToDo: 'Scrape off the mould with a dry cloth and let the soil dry out further than usual.',
    longerTerm: 'Water less often, improve airflow around the plant, and top-dress with fresh compost.',
  },
];

/** Keyword match against a free-text description. Returns null when nothing
 *  clearly matches, rather than guessing — an honest "I'm not sure". */
export function matchSymptom(text: string): CareSymptom | null {
  const q = text.toLowerCase();
  const keywords: Array<[string[], number]> = [
    [['yellow', 'yellowing', 'pale'], 0],
    [['bug', 'pest', 'insect', 'mite', 'aphid', 'mealy', 'webbing', 'sticky'], 1],
    [['stunted', 'leggy', 'not growing', 'slow', 'small leaves', 'stretching'], 2],
    [['brown tip', 'crispy', 'brown edge', 'dry tip', 'brown'], 3],
    [['droop', 'wilt', 'limp', 'sagging', 'falling over'], 4],
    [['mould', 'mold', 'fungus', 'white fuzz', 'fuzzy'], 5],
  ];
  for (const [words, index] of keywords) {
    if (words.some((w) => q.includes(w))) return CARE_SYMPTOMS[index];
  }
  return null;
}
