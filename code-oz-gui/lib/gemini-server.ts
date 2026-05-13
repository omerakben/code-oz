import { GoogleGenAI } from '@google/genai';

const GEMINI_FLASH_MODEL = 'gemini-3-flash-preview';

let client: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set.');
  }

  client ??= new GoogleGenAI({ apiKey });
  return client;
}

export async function askGemini(input: {
  readonly systemInstruction: string;
  readonly userPrompt: string;
}): Promise<string> {
  const response = await getGeminiClient().models.generateContent({
    model: GEMINI_FLASH_MODEL,
    contents: input.userPrompt,
    config: {
      systemInstruction: input.systemInstruction,
    },
  });

  return response.text ?? '';
}
