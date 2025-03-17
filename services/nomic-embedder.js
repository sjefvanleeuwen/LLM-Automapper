const fetch = require('node-fetch');

class NomicEmbedder {
  constructor(apiKey = null, model = 'nomic-embed-text:latest') {
    this.model = model;
    this.useLocalOllama = true;
    this.ollamaUrl = 'http://localhost:11434/api/embeddings';
  }

  async embedText(text) {
    if (!text || typeof text !== 'string') {
      throw new Error('Invalid input: text must be a non-empty string');
    }

    try {
      const response = await fetch(this.ollamaUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          prompt: text,
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama embeddings API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data.embedding;
    } catch (error) {
      console.error('Error generating embeddings:', error);
      throw error;
    }
  }

  async embedBatch(texts, batchSize = 32) {
    if (!Array.isArray(texts) || texts.length === 0) {
      throw new Error('Invalid input: texts must be a non-empty array');
    }

    const embeddings = [];
    
    // Process in batches to avoid overwhelming the API
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchPromises = batch.map(text => this.embedText(text));
      const batchResults = await Promise.all(batchPromises);
      embeddings.push(...batchResults);
    }

    return embeddings;
  }
}

module.exports = NomicEmbedder;
