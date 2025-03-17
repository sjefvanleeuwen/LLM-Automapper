const fetch = require('node-fetch');

class OllamaClient {
  constructor(baseUrl = 'http://localhost:11434', model = 'llama3') {
    this.baseUrl = baseUrl;
    this.model = model;
  }

  async generate(prompt, options = {}) {
    const defaultOptions = {
      temperature: 0.7,
      max_tokens: 4096, // Increased token limit for code generation
      stream: false,
    };

    const requestOptions = {
      ...defaultOptions,
      ...options,
      prompt,
      model: this.model,
    };

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestOptions),
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data.response;
    } catch (error) {
      console.error('Error calling Ollama:', error);
      throw error;
    }
  }

  async isModelAvailable() {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) {
        return false;
      }
      const data = await response.json();
      return data.models.some(model => model.name === this.model);
    } catch (error) {
      console.error('Error checking model availability:', error);
      return false;
    }
  }
}

module.exports = OllamaClient;
