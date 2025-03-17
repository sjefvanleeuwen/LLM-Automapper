/**
 * Calculate cosine similarity between two vectors
 * @param {number[]} a - First vector
 * @param {number[]} b - Second vector
 * @returns {number} Similarity score between 0 and 1
 */
function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same dimensions');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Find the most similar vectors to a query vector
 * @param {number[]} queryVector - The vector to compare against
 * @param {Array<{vector: number[], metadata: any}>} vectorStore - Array of vectors with metadata
 * @param {number} topK - Number of results to return
 * @returns {Array<{similarity: number, metadata: any}>}
 */
function findSimilarVectors(queryVector, vectorStore, topK = 5) {
  const results = vectorStore.map(item => ({
    similarity: cosineSimilarity(queryVector, item.vector),
    metadata: item.metadata
  }));

  return results
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
}

module.exports = {
  cosineSimilarity,
  findSimilarVectors
};
