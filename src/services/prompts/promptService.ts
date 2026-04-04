import AsyncStorage from "@react-native-async-storage/async-storage";
import { PROMPTS } from "../../constants/prompts";
import { PromptItem } from "../../types/pipeline";

const LAST_PROMPTS_KEY = "pycsure:last-prompts";
const HISTORY_SIZE = 15;
const PROMPT_COOLDOWN_MS = 2500;

let inMemoryHistory: string[] = [];
let lastPromptIssuedAt = 0;

async function hydrateHistory() {
  if (inMemoryHistory.length > 0) {
    return;
  }

  const saved = await AsyncStorage.getItem(LAST_PROMPTS_KEY);
  if (!saved) {
    return;
  }

  try {
    const parsed = JSON.parse(saved) as string[];
    inMemoryHistory = parsed.slice(0, HISTORY_SIZE);
  } catch {
    inMemoryHistory = [];
  }
}

async function persistHistory() {
  await AsyncStorage.setItem(LAST_PROMPTS_KEY, JSON.stringify(inMemoryHistory.slice(0, HISTORY_SIZE)));
}

export interface PromptQuery {
  vibe?: PromptItem["vibe"];
  category?: PromptItem["category"];
}

export async function getRandomPrompt(query?: PromptQuery): Promise<PromptItem> {
  await hydrateHistory();
  const pool = PROMPTS.filter((prompt) => {
    if (query?.vibe && prompt.vibe !== query.vibe) {
      return false;
    }
    if (query?.category && prompt.category !== query.category) {
      return false;
    }
    return true;
  });

  const resolvedPool = pool.length > 0 ? pool : PROMPTS;
  const unseen = resolvedPool.filter((prompt) => !inMemoryHistory.includes(prompt.id));
  const candidatePool = unseen.length > 0 ? unseen : resolvedPool;
  const now = Date.now();
  const enforceCooldown = now - lastPromptIssuedAt < PROMPT_COOLDOWN_MS;
  const trimmedPool =
    enforceCooldown && candidatePool.length > 1
      ? candidatePool.filter((prompt) => prompt.id !== inMemoryHistory[0])
      : candidatePool;
  const selectedPool = trimmedPool.length > 0 ? trimmedPool : candidatePool;
  const selected = selectedPool[Math.floor(Math.random() * selectedPool.length)];

  inMemoryHistory = [selected.id, ...inMemoryHistory].slice(0, HISTORY_SIZE);
  lastPromptIssuedAt = now;
  await persistHistory();
  return selected;
}

export function getPromptCount() {
  return PROMPTS.length;
}
