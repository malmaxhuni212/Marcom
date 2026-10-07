import { LLMProvider, LLMRequest } from './provider';

export class GeminiProvider implements LLMProvider {
  model = 'gemini-pro';
  readonly name = 'gemini';
  
  constructor(private apiKey: string = process.env.GEMINI_API_KEY || '') {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY is not set');
    }
  }

  async complete(request: LLMRequest): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${this.apiKey}`;
    
    // We will use standard text generation, instructing the model via system prompt
    // and relying on our extractJson function, which is more robust than strict JSON mode sometimes.
    const payload = {
      systemInstruction: {
        parts: [{ text: request.system }]
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: request.user }]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API Error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!text) {
      throw new Error('No text returned from Gemini');
    }

    return text;
  }
}
