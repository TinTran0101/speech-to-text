import translate from "google-translate-api-x";
import kuromoji from "kuromoji";
import { toHiragana, toRomaji } from "wanakana";
import { fileURLToPath } from "node:url";

const dictionaryPath = fileURLToPath(new URL("../node_modules/kuromoji/dict", import.meta.url));
const translationProvider = "google-translate-api-x";
const maxTranslationBatchCharacters = 4500;
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

function createTranslationBatches(analyses) {
  const batches = [];
  let current = [];
  let currentLength = 0;

  for (const [index, analysis] of analyses.entries()) {
    const text = analysis.text.trim();
    if (!text) continue;
    if (current.length && currentLength + text.length > maxTranslationBatchCharacters) {
      batches.push(current);
      current = [];
      currentLength = 0;
    }
    current.push({ index, text });
    currentLength += text.length;
  }

  if (current.length) batches.push(current);
  return batches;
}

async function translateBatch(batch, translator, client = "t") {
  const results = await translator(
    batch.map((item) => item.text),
    {
      from: "ja",
      to: "vi",
      client,
      forceBatch: true,
      rejectOnPartialFail: false,
      requestOptions: { signal: AbortSignal.timeout(20_000) },
    },
  );
  return Array.isArray(results) ? results : [results];
}

async function translateAnalyses(analyses, translator) {
  for (const batch of createTranslationBatches(analyses)) {
    let translations;
    try {
      translations = await translateBatch(batch, translator);
    } catch {
      translations = await translateBatch(batch, translator, "gtx");
    }

    translations.forEach((translation, batchIndex) => {
      const analysis = analyses[batch[batchIndex]?.index];
      const translatedText = translation?.text?.trim();
      if (!analysis || !translatedText) return;
      analysis.translationVi = translatedText;
      analysis.translationProvider = translationProvider;
    });
  }
}

export async function analyzeJapaneseSentences(
  sentences,
  { translate: shouldTranslate = true, translator = translate } = {},
) {
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

    analyses.push(analysis);
  }

  if (shouldTranslate) {
    try {
      await translateAnalyses(analyses, translator);
    } catch (error) {
      console.warn("Khong the dich cau tieng Nhat bang Google Translate:", error.message);
    }
  }

  return {
    engine: "kuromoji + wanakana",
    translationEnabled: shouldTranslate,
    translationProvider: shouldTranslate ? translationProvider : null,
    sentences: analyses,
  };
}

export function looksJapanese(value) {
  return hasJapanese(value);
}
