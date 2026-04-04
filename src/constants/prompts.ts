import { PromptItem } from "../types/pipeline";

const ACTIONS = [
  "pretend you are",
  "act like you just discovered",
  "pose as if you are guarding",
  "freeze like you are balancing",
  "look shocked that you dropped",
  "celebrate like you won",
  "stare dramatically at",
  "point suspiciously at",
  "strike a superhero pose with",
  "whisper to",
  "show off",
  "try to high-five",
  "mime throwing",
  "do your best model walk toward",
  "pretend to interview",
  "make a dramatic trailer face for",
  "fake a laugh with",
  "pose like a secret agent near",
  "pretend to hide from",
  "act like you are late for"
] as const;

const OBJECTS = [
  "an invisible pizza",
  "a tiny dragon",
  "a confused pigeon",
  "your future self",
  "a haunted shopping cart",
  "a mystery button",
  "a floating taco",
  "a karaoke microphone",
  "a giant rubber duck",
  "a pretend paparazzi",
  "the final slice of cake",
  "a suspiciously loud toaster",
  "an award nobody asked for",
  "a dramatic weather forecast",
  "a dance battle",
  "an alien tour guide",
  "a fake movie poster",
  "the world record trophy",
  "a runaway balloon",
  "a very important banana"
] as const;

const VIBES: PromptItem["vibe"][] = ["goofy", "group", "selfie", "energetic", "awkward"];
const CATEGORIES: PromptItem["category"][] = ["expression", "pose", "interaction", "movement"];

export const PROMPTS: PromptItem[] = ACTIONS.flatMap((action, actionIndex) =>
  OBJECTS.map((object, objectIndex) => {
    const id = `prompt_${actionIndex}_${objectIndex}`;
    return {
      id,
      text: `${action} ${object}.`,
      vibe: VIBES[(actionIndex + objectIndex) % VIBES.length],
      category: CATEGORIES[(actionIndex * 2 + objectIndex) % CATEGORIES.length]
    };
  })
);
