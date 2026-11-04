import { resolve } from './ai';

// Does this message need current information (news, prices, weather, scores...)? Plain pattern matching, so it costs nothing and adds no delay.
const NOW = /\b(today|tonight|right now|currently|at the moment|this (?:week|month|year|morning|evening|weekend)|yesterday|tomorrow|latest|newest|breaking|up[- ]to[- ]date|as of now|these days)\b/i;
const TOPIC = /\b(news|headlines?|weather|forecast|temperature|stocks?|share price|stock price|market cap|exchange rate|interest rates?|inflation rate|(?:live )?scores?|fixtures?|standings|election results?|trending|release date|opening hours|box office|bitcoin|ethereum|crypto prices?|nifty|sensex|nasdaq|dow jones|s&p 500|gold price|oil price|petrol price)\b/i;
const PRICE = /\b(?:price|cost|rate)s? of\b|\bhow much (?:is|are|does|do)\b.*\b(?:cost|worth|trading)\b/i;
const CURRENT = /\b(?:who is|who's|what is|what's) (?:the )?(?:current|new|present|latest)\b|\bwhat(?:'s| is) happening\b|\bany (?:news|updates?) (?:on|about)\b/i;
const YEAR = /\b20(?:2[5-9]|3\d)\b/;

export function needsLive(text) {
  const t = String(text || '').trim();
  // Long pastes and code are about the pasted text, not the world.
  if (t.length < 6 || t.length > 500 || /```/.test(t)) return false;
  return NOW.test(t) || TOPIC.test(t) || PRICE.test(t) || CURRENT.test(t) || (YEAR.test(t) && /\b(?:who|what|when|where|latest|winner|result)\b/i.test(t));
}

// Search only works on Gemini models with the user's own key. Anywhere else it would just print a warning, so it stays off.
export const canWebSearch = (settings, model) => resolve(settings, model).kind === 'gemini' && !!settings.keys?.gemini;
