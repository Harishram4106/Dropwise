// Is the answer to this prompt likely to change over time? If so the semantic cache must be
// bypassed, because a cached answer could be out of date. Rules only: this runs on every
// request, so it adds no model call and no Tavily credit (Tavily stays in the registry).

interface Rule {
  id: string;
  pattern: RegExp;
  reason: string;
}

const RULES: Rule[] = [
  {
    id: "relative_time",
    pattern:
      /\b(today|tonight|tomorrow|yesterday|right now|at the moment|currently|these days|nowadays|as of (now|today)|so far this \w+|this (morning|afternoon|evening|week|weekend|month|quarter|season|year)|last (night|week|weekend|month)|next (week|weekend|month|match|game|race)|(today|tonight|yesterday|tomorrow|this week)'s)\b/i,
    reason: "refers to a time relative to now",
  },
  {
    id: "recency",
    pattern: /\b(latest|newest|most recent|recently|breaking|trending|up[- ]to[- ]date|upcoming)\b/i,
    reason: "asks for the latest information",
  },
  {
    id: "current_role",
    // "current" only as an adjective for things that change; "electric current" stays evergreen.
    pattern:
      /\bcurrent (president|prime minister|ceo|leader|champion|record|price|rate|status|version|weather|score|state of|events|news|ranking|population|holder|government|chancellor|king|queen|pope|world)\b/i,
    reason: "asks about the current holder or state of something",
  },
  {
    id: "volatile_topic",
    pattern:
      /\b(weather|forecast|exchange rate|stock price|share price|price of|prices of|headlines|news|standings|election results?|box office|live (scores?|stream|updates?|results?|coverage|feed))\b/i,
    reason: "asks about something that changes often (prices, weather, news, scores)",
  },
  {
    id: "outage",
    pattern: /\bis [\w.\- ]{1,30} (down|offline|having an outage)\b/i,
    reason: "asks about a service's live status",
  },
];

const WHO_WON = /\bwho (won|is winning|leads|is leading)\b/i;
const EVENT_WORDS = /\b(win|won|winner|champion|election|release|launch|results?|price|schedule|dates?|fixtures?|happen|budget)\b/i;

export interface Timeliness {
  time_sensitive: boolean;
  signals: string[];
  reasons: string[];
}

export function timeSensitivity(instruction: string, now = new Date()): Timeliness {
  const hits = RULES.filter((r) => r.pattern.test(instruction));
  const signals = hits.map((r) => r.id);
  const reasons = hits.map((r) => r.reason);

  const years = [...instruction.matchAll(/\b(19|20)\d\d\b/g)].map((m) => Number(m[0]));
  const thisYear = now.getUTCFullYear();

  // "Who won the 1966 World Cup?" has a settled answer; "who won last night?" does not.
  if (WHO_WON.test(instruction) && !years.some((y) => y < thisYear)) {
    signals.push("who_won");
    reasons.push("asks who won without naming a past year");
  }
  if (years.some((y) => y >= thisYear) && EVENT_WORDS.test(instruction)) {
    signals.push("current_year_event");
    reasons.push("asks about an event this year or later");
  }

  return { time_sensitive: signals.length > 0, signals, reasons };
}
