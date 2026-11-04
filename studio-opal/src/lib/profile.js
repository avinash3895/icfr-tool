import { APP_CONTEXT } from './appcontext';
import { uid } from './util';

// Everything in here is written by the user, by hand or with "remember this". Nothing is added behind their back,
// and the model never rewrites it, so it stays small and costs the same number of tokens every time.
export const PROFILE_CHAR_CAP = 6000;

const active = (settings) => (settings.memories || []).filter((m) => m.on !== false && String(m.text || '').trim());

// The part the user writes: how the AI should talk, and the notes they asked it to keep.
export function userProfileText(settings) {
  const persona = String(settings.persona || '').trim();
  const mems = active(settings);
  const parts = [];
  if (persona) parts.push(`HOW TO TALK TO THE USER (follow this in every reply, whichever AI model you are):\n${persona}`);
  if (mems.length) parts.push(`THINGS THE USER ASKED YOU TO REMEMBER (treat these as facts and standing preferences):\n${mems.map((m) => `- ${String(m.text).trim()}`).join('\n')}`);
  return parts.join('\n\n');
}

// Everything placed in front of an answer, so any model knows the app and sounds the same: app knowledge first, then the user's own text.
export function profileText(settings) {
  const parts = [];
  if (settings.appContextOn !== false) parts.push(APP_CONTEXT);
  const mine = userProfileText(settings);
  if (mine) parts.push(mine);
  return parts.join('\n\n');
}

// The size meter counts only what the user wrote.
export const profileSize = (settings) => userProfileText(settings).length;
export const approxTokens = (chars) => Math.ceil(chars / 4);

// Puts the profile in front of a system prompt.
export function withProfile(settings, system) {
  const p = profileText(settings);
  return p ? `${p}\n\n---\n\n${system || ''}`.trim() : system || '';
}

export const newMemory = (text) => ({ id: uid(), text: String(text).trim(), on: true, at: Date.now() });

// "save this to your mind", "remember this: ...", "remember that I prefer ...". A plain "remember to buy milk" is not matched.
const REMEMBER = /^\s*(?:please\s+|pls\s+)?(?:(?:remember|memori[sz]e|save|store|note|keep|add)\b[^.\n:]{0,40}?\b(?:mind|memory|memories)\b|remember\s+(?:this|that|it)\b|memori[sz]e\s+(?:this|that|it)\b)/i;

// Returns null when the message is not a "save this" request. Otherwise the text to save, or '' when it must come from the conversation.
export function parseRemember(text) {
  const t = String(text || '').trim();
  if (!REMEMBER.test(t)) return null;
  const colon = t.indexOf(':');
  let rest = colon >= 0 ? t.slice(colon + 1) : t.replace(REMEMBER, '');
  rest = rest.replace(/^\s*(?:to\s+(?:your\s+)?(?:mind|memory)|that)\b[\s,:-]*/i, '').replace(/^[\s,:-]+/, '').trim();
  if (rest.length < 8 || /^(this|that|it)[.!]*$/i.test(rest)) return '';
  return rest;
}

export const DISTILL_PROMPT = 'The user wants you to remember something from this conversation. Write ONE short sentence (at most 30 words) that states the standing instruction or fact they want kept, phrased so any AI model can follow it later. No quotes, no preamble, no "the user says". Reply with the sentence only.';

export const PERSONA_PRESETS = [
  ['Professional', 'Be professional and precise. Lead with the answer, then the reasoning. Use plain, formal English. No filler, no emojis, no flattery.'],
  ['Friendly', 'Be warm and conversational, like a smart friend. Keep it simple and encouraging, and never talk down to me.'],
  ['Brief', 'Keep answers as short as possible. Use bullet points. Only add detail when I ask for it.'],
  ['Coach', 'Challenge my thinking. Ask me one clarifying question before big tasks, point out risks, and tell me honestly when I am wrong.'],
];
