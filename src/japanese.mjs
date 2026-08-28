import kuromoji from "kuromoji";
import { toHiragana, toRomaji } from "wanakana";
import { fileURLToPath } from "node:url";

const dictionaryPath = fileURLToPath(new URL("../node_modules/kuromoji/dict", import.meta.url));
let tokenizerPromise;

function getTokenizer() {
  if (!tokenizerPromise) {
    tokenizerPromise = new Promise((resolve, reject) => {
      kuromoji.builder({ dicPath: dictionaryPath }).build((error, tokenizer) => {
        if (error) reject(error);
        else resolve(tokenizer);
      });
    });
  }
  return tokenizerPromise;
}

function hasJapanese(value) {
  return /[\u3040-\u30ff\u3400-\u9fff]/u.test(value || "");
}

function readingForToken(token) {
  const katakana = token.reading || token.pronunciation;
  if (!katakana) return hasJapanese(token.surface_form) ? "" : token.surface_form;
  return toHiragana(katakana);
}

function shouldClosePhrase(token, phraseLength) {
  if (token.pos === "記号") return true;
  if (token.pos === "助詞") return true;
  if (token.pos === "助動詞" && phraseLength >= 2) return true;
  return phraseLength >= 5;
}

function groupIntoPhrases(tokens) {
  const phrases = [];
  let current = [];

  const flush = () => {
    if (!current.length) return;
    const surface = current.map((token) => token.surface_form).join("");
    const reading = current.map(readingForToken).join("");
    phrases.push({
      surface,
      reading,
      romaji: reading ? toRomaji(reading) : "",
      hasKanji: /[\u3400-\u9fff]/u.test(surface),
      tokens: current.map((token) => ({
        surface: token.surface_form,
        reading: readingForToken(token),
        base: token.basic_form === "*" ? token.surface_form : token.basic_form,
        partOfSpeech: token.pos,
      })),
    });
    current = [];
  };

  for (const token of tokens) {
    current.push(token);
    if (shouldClosePhrase(token, current.length)) flush();
  }
  flush();
  return phrases;
}

async function translateWithLibreTranslate(text) {
  const baseUrl = process.env.LIBRETRANSLATE_URL;
  if (!baseUrl || !text.trim()) return null;

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      q: text,
      source: "ja",
      target: "vi",
      format: "text",
      ...(process.env.LIBRETRANSLATE_API_KEY
        ? { api_key: process.env.LIBRETRANSLATE_API_KEY }
        : {}),
    }),
  });

  if (!response.ok) throw new Error(`LibreTranslate HTTP ${response.status}`);
  const result = await response.json();
  return result.translatedText || null;
}

export async function analyzeJapaneseSentences(sentences, { translate = true } = {}) {
  const tokenizer = await getTokenizer();
  const analyses = [];

  for (const sentence of sentences) {
    const text = String(sentence.text || "").trim();
    const analysis = {
      id: sentence.id,
      text,
      phrases: groupIntoPhrases(tokenizer.tokenize(text)),
      translationVi: null,
      translationProvider: null,
    };

    if (translate && process.env.LIBRETRANSLATE_URL) {
      try {
        analysis.translationVi = await translateWithLibreTranslate(text);
        analysis.translationProvider = "libretranslate";
      } catch (error) {
        console.warn("Khong the dich cau tieng Nhat:", error.message);
      }
    }
    analyses.push(analysis);
  }

  return {
    engine: "kuromoji + wanakana",
    translationEnabled: Boolean(process.env.LIBRETRANSLATE_URL),
    sentences: analyses,
  };
}

export function looksJapanese(value) {
  return hasJapanese(value);
}
