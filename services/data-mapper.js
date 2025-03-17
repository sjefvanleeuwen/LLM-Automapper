const fs = require('fs').promises;
const path = require('path');
const OllamaClient = require('./ollama-client');
const NomicEmbedder = require('./nomic-embedder');
const { findSimilarVectors } = require('../utils/vector-utils');

class DataMapper {
  constructor(config = {}) {
    this.ollama = new OllamaClient(
      config.ollamaBaseUrl || 'http://localhost:11434', 
      config.ollamaModel || 'llama3'
    );
    this.embedder = new NomicEmbedder(null, config.nomicModel || 'nomic-embed-text:latest');
    this.vectorStore = [];
    this.initialized = false;
  }

  /**
   * Parse a data structure file and extract its structure and content
   * @param {string} filePath - Path to the data structure file
   * @returns {Object} Parsed data structure
   */
  async parseDataFile(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const fileExt = path.extname(filePath).toLowerCase();
      
      // Determine file type and use appropriate parsing strategy
      let parsedStructure;
      
      if (fileExt === '.json') {
        // Try to parse as JSON directly
        try {
          parsedStructure = JSON.parse(content);
        } catch (jsonError) {
          console.log('File has .json extension but is not valid JSON, using LLM to parse');
          parsedStructure = await this.parseMixedContent(content);
        }
      } else {
        // For text files, markdown, or any other format, use the LLM to extract structure
        parsedStructure = await this.parseMixedContent(content);
      }

      return {
        filename: path.basename(filePath),
        path: filePath,
        structure: parsedStructure,
        content
      };
    } catch (error) {
      console.error(`Error processing file ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Use LLM to parse and extract structure from mixed or descriptive content
   * @param {string} content - The file content to parse
   * @returns {Object} Extracted structure
   */
  async parseMixedContent(content) {
    // Ask Llama3 to help parse and understand the content
    const prompt = `Analyze the following document that describes a data structure.
      It could be a formal schema, a natural language description, or a mix of both.
      Extract all the fields, their data types, relationships, and any other relevant information.
      
      For each field, identify:
      1. Field name
      2. Data type
      3. Description or purpose
      4. Any parent/child relationships (nested fields)
      5. Any constraints or validation rules
      
      Return a structured JSON representation with this information.
      The JSON must be valid and properly formatted.
      
      Document content:
      ${content}`;
    
    const structureAnalysis = await this.ollama.generate(prompt);
    
    // Extract JSON from the response if possible
    try {
      // Find JSON-like content in the response
      let jsonContent = null;
      
      // Try to extract JSON from code blocks first
      const jsonBlockMatch = structureAnalysis.match(/```(?:json)?\n([\s\S]*?)\n```/);
      if (jsonBlockMatch && jsonBlockMatch[1]) {
        jsonContent = jsonBlockMatch[1].trim();
      } 
      // If no code block found, try to extract JSON between curly braces
      else {
        const jsonBracesMatch = structureAnalysis.match(/(\{[\s\S]*\})/);
        if (jsonBracesMatch && jsonBracesMatch[1]) {
          jsonContent = jsonBracesMatch[1].trim();
        }
      }
      
      if (jsonContent) {
        // Clean up the JSON before parsing (common issues from LLMs)
        // Fix trailing commas in arrays and objects
        jsonContent = jsonContent
          .replace(/,\s*]/g, ']')
          .replace(/,\s*}/g, '}')
          // Fix missing commas between array elements that are objects
          .replace(/}\s*{/g, '},{')
          // Fix extra commas
          .replace(/,,+/g, ',');
        
        try {
          return JSON.parse(jsonContent);
        } catch (initialParseError) {
          console.log('Error parsing LLM response JSON, attempting recovery:', initialParseError.message);
          
          // If initial parse fails, make a second attempt with more aggressive cleaning
          // Sometimes the LLM includes extra text or explanations in the JSON output
          
          // Try to find the most outer valid JSON object
          const potentialJsonObjects = [];
          let bracketCount = 0;
          let startPos = -1;
          
          for (let i = 0; i < jsonContent.length; i++) {
            if (jsonContent[i] === '{' && startPos === -1) {
              startPos = i;
              bracketCount = 1;
            } else if (jsonContent[i] === '{') {
              bracketCount++;
            } else if (jsonContent[i] === '}') {
              bracketCount--;
              if (bracketCount === 0 && startPos !== -1) {
                potentialJsonObjects.push(jsonContent.substring(startPos, i + 1));
                startPos = -1;
              }
            }
          }
          
          // Try to parse each potential JSON object, starting with the largest
          potentialJsonObjects.sort((a, b) => b.length - a.length);
          
          for (const potentialJson of potentialJsonObjects) {
            try {
              return JSON.parse(potentialJson);
            } catch (e) {
              console.log('Failed to parse potential JSON object, trying next one');
            }
          }
          
          // If all parsing attempts fail, fall back to text extraction
          return this.extractFieldsFromText(structureAnalysis);
        }
      } else {
        // If no JSON found, extract fields using a more flexible approach
        return this.extractFieldsFromText(structureAnalysis);
      }
    } catch (parseError) {
      console.error('Error parsing LLM structure response:', parseError);
      // Fallback to simpler text-based extraction
      return this.extractFieldsFromText(content);
    }
  }

  /**
   * Extract fields from text using a simple line-by-line approach
   * @param {string} text - Text to extract fields from
   * @returns {Object} Simple structure with fields
   */
  extractFieldsFromText(text) {
    // Try to extract field-like patterns from the text
    const fields = [];
    
    // First try with regex for field patterns like "FieldName: Description" or "FieldName - Description"
    const fieldRegex = /([A-Za-z0-9_]+)[\s:]+(.*?)(?=\n[A-Za-z0-9_]+[\s:]|$)/g;
    let match;
    
    while ((match = fieldRegex.exec(text)) !== null) {
      const fieldName = match[1].trim();
      const description = match[2].trim();
      
      // Skip common non-field lines
      if (fieldName.toLowerCase() === 'document' || 
          fieldName.toLowerCase() === 'content' ||
          fieldName.toLowerCase() === 'field' ||
          fieldName.toLowerCase() === 'return' ||
          fieldName.toLowerCase() === 'struct') {
        continue;
      }
      
      // Check if we can extract a type from the description
      let fieldType = 'string'; // Default type
      const typeMatch = description.match(/\b(string|number|integer|int|float|double|boolean|bool|date|datetime|array|object)\b/i);
      
      if (typeMatch) {
        fieldType = typeMatch[1].toLowerCase();
      }
      
      fields.push({
        field: fieldName,
        type: fieldType,
        description: description
      });
    }
    
    // If that didn't yield results, try line-by-line with various patterns
    if (fields.length === 0) {
      const lines = text.split('\n');
      
      for (const line of lines) {
        const trimmedLine = line.trim();
        // Skip empty lines or lines that are too short
        if (trimmedLine.length < 3) continue;
        
        // Skip lines that look like headers or separators
        if (trimmedLine.startsWith('#') || trimmedLine === '---' || trimmedLine.startsWith('//')) continue;
        
        // Try different patterns
        const colonPattern = trimmedLine.indexOf(':');
        const dashPattern = trimmedLine.indexOf(' - ');
        
        if (colonPattern > 0) {
          const fieldName = trimmedLine.substring(0, colonPattern).trim();
          const description = trimmedLine.substring(colonPattern + 1).trim();
          
          // Skip if field name contains spaces or special characters (probably not a field)
          if (/^[A-Za-z0-9_]+$/.test(fieldName)) {
            fields.push({
              field: fieldName,
              description: description
            });
          }
        } else if (dashPattern > 0) {
          const fieldName = trimmedLine.substring(0, dashPattern).trim();
          const description = trimmedLine.substring(dashPattern + 3).trim();
          
          // Skip if field name contains spaces or special characters (probably not a field)
          if (/^[A-Za-z0-9_]+$/.test(fieldName)) {
            fields.push({
              field: fieldName,
              description: description
            });
          }
        } else if (trimmedLine.startsWith('-') || trimmedLine.startsWith('*')) {
          // Handle bullet points
          const bulletContent = trimmedLine.substring(1).trim();
          const bulletColonPattern = bulletContent.indexOf(':');
          
          if (bulletColonPattern > 0) {
            const fieldName = bulletContent.substring(0, bulletColonPattern).trim();
            const description = bulletContent.substring(bulletColonPattern + 1).trim();
            
            // Skip if field name contains spaces or special characters (probably not a field)
            if (/^[A-Za-z0-9_]+$/.test(fieldName)) {
              fields.push({
                field: fieldName,
                description: description
              });
            }
          }
        }
      }
    }
    
    // If we still have no fields, just extract capitalized words as potential field names
    if (fields.length === 0) {
      const potentialFields = text.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)*\b/g);
      if (potentialFields) {
        potentialFields.forEach(field => {
          fields.push({
            field: field,
            description: `Extracted from text (no explicit description)`
          });
        });
      }
    }
    
    return {
      fields: fields,
      raw: text
    };
  }

  /**
   * Embed a data structure for vector search
   * @param {Object} dataStructure - Parsed data structure
   * @returns {Object} Data structure with embeddings
   */
  async embedDataStructure(dataStructure) {
    const fieldsToEmbed = [];
    const fieldDescriptions = [];

    // First try to extract fields from the structured schema
    if (dataStructure.structure) {
      // Handle JSON schema style objects
      if (dataStructure.structure.schema) {
        this.extractFieldsFromSchema(dataStructure.structure.schema, '', fieldsToEmbed, fieldDescriptions);
      }
      // Handle direct field lists
      else if (dataStructure.structure.fields) {
        dataStructure.structure.fields.forEach(field => {
          if (field.field) {
            fieldsToEmbed.push(field.field);
            let description = field.description || '';
            if (field.type) description += ` (${field.type})`;
            fieldDescriptions.push(`${field.field}: ${description}`);
          }
        });
      }
      // Handle raw object structure
      else {
        this.extractFieldsFromObject(dataStructure.structure, '', fieldsToEmbed, fieldDescriptions);
      }
    }

    // If no fields were found in the structure, try to extract from raw content
    if (fieldsToEmbed.length === 0) {
      const contentFields = this.extractFieldsFromText(dataStructure.content);
      
      if (contentFields.fields) {
        contentFields.fields.forEach(field => {
          if (field.field) {
            fieldsToEmbed.push(field.field);
            fieldDescriptions.push(`${field.field}: ${field.description}`);
          }
        });
      }
    }

    // Add the raw content as well for full-text embedding
    fieldDescriptions.push(dataStructure.content);

    // Generate embeddings for each field description
    const embeddings = await this.embedder.embedBatch(fieldDescriptions);
    
    const embeddedStructure = {
      ...dataStructure,
      embeddings: {
        fields: fieldsToEmbed.map((field, i) => ({
          field,
          vector: embeddings[i]
        })),
        fullContent: embeddings[embeddings.length - 1]
      }
    };

    // Add to vector store
    this.vectorStore.push({
      vector: embeddedStructure.embeddings.fullContent,
      metadata: {
        type: 'document',
        filename: embeddedStructure.filename,
        path: embeddedStructure.path
      }
    });

    embeddedStructure.embeddings.fields.forEach((field, i) => {
      this.vectorStore.push({
        vector: field.vector,
        metadata: {
          type: 'field',
          field: field.field,
          filename: embeddedStructure.filename,
          path: embeddedStructure.path
        }
      });
    });

    return embeddedStructure;
  }

  /**
   * Recursively extract fields from a schema object
   * @param {Object} schema - Schema object
   * @param {string} prefix - Field prefix for nested fields
   * @param {Array} fieldsToEmbed - Array to collect field names
   * @param {Array} fieldDescriptions - Array to collect field descriptions
   */
  extractFieldsFromSchema(schema, prefix, fieldsToEmbed, fieldDescriptions) {
    if (!schema || typeof schema !== 'object') return;
    
    Object.entries(schema).forEach(([key, value]) => {
      const fieldName = prefix ? `${prefix}.${key}` : key;
      
      if (value && typeof value === 'object') {
        // Check if it's a property definition with type
        if (value.type) {
          fieldsToEmbed.push(fieldName);
          const description = value.description || '';
          fieldDescriptions.push(`${fieldName}: ${description} (${value.type})`);
        } 
        // Check if it's an array
        else if (Array.isArray(value)) {
          fieldsToEmbed.push(fieldName);
          fieldDescriptions.push(`${fieldName}: Array of items`);
          
          // If array has objects, process the first one as an example
          if (value.length > 0 && typeof value[0] === 'object') {
            this.extractFieldsFromSchema(value[0], `${fieldName}[0]`, fieldsToEmbed, fieldDescriptions);
          }
        } 
        // Recursively process nested objects
        else {
          this.extractFieldsFromSchema(value, fieldName, fieldsToEmbed, fieldDescriptions);
        }
      } else {
        fieldsToEmbed.push(fieldName);
        fieldDescriptions.push(`${fieldName}: ${value}`);
      }
    });
  }

  /**
   * Recursively extract fields from any object
   * @param {Object} obj - Object to extract fields from
   * @param {string} prefix - Field prefix for nested fields
   * @param {Array} fieldsToEmbed - Array to collect field names
   * @param {Array} fieldDescriptions - Array to collect field descriptions
   */
  extractFieldsFromObject(obj, prefix, fieldsToEmbed, fieldDescriptions) {
    if (!obj || typeof obj !== 'object') return;
    
    Object.entries(obj).forEach(([key, value]) => {
      const fieldName = prefix ? `${prefix}.${key}` : key;
      
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        // Recursively process nested objects
        this.extractFieldsFromObject(value, fieldName, fieldsToEmbed, fieldDescriptions);
      } else {
        fieldsToEmbed.push(fieldName);
        const valueDesc = Array.isArray(value) ? 'Array' : value;
        fieldDescriptions.push(`${fieldName}: ${valueDesc}`);
      }
    });
  }

  /**
   * Load and process multiple data structure files
   * @param {string[]} filePaths - Array of file paths 
   */
  async loadDataFiles(filePaths) {
    const structures = [];
    
    for (const filePath of filePaths) {
      try {
        const structure = await this.parseDataFile(filePath);
        const embeddedStructure = await this.embedDataStructure(structure);
        structures.push(embeddedStructure);
      } catch (error) {
        console.error(`Error processing ${filePath}:`, error);
      }
    }

    this.initialized = true;
    return structures;
  }

  /**
   * Map fields between source and target based on semantic similarity
   * @param {string} sourcePath - Path to source data structure
   * @param {string} targetPath - Path to target data structure
   * @returns {Object} Mapping between source and target fields
   */
  async mapDataStructures(sourcePath, targetPath) {
    if (!this.initialized) {
      throw new Error('DataMapper not initialized. Call loadDataFiles first.');
    }

    const sourceStructure = await this.parseDataFile(sourcePath);
    const targetStructure = await this.parseDataFile(targetPath);
    
    // If we have a vector store, try to enrich our understanding with relevant context
    let sourceEnrichment = null;
    let targetEnrichment = null;
    let vectorKnowledgeContext = '';
    
    if (this.vectorStore.length > 0) {
      console.log('Enriching mapping with knowledge from vector database...');
      
      // Extract knowledge related to source structure
      sourceEnrichment = await this.extractKnowledgeFromVectorDB(
        sourceStructure.content + ' ' + JSON.stringify(sourceStructure.structure),
        3
      );
      
      // Extract knowledge related to target structure
      targetEnrichment = await this.extractKnowledgeFromVectorDB(
        targetStructure.content + ' ' + JSON.stringify(targetStructure.structure),
        3
      );
      
      // Prepare context from the enrichments to help with mapping
      if (sourceEnrichment && targetEnrichment) {
        vectorKnowledgeContext = `
        Additional Context from Vector Database:
        
        Source Structure Context:
        ${sourceEnrichment.knowledgeSynthesis.substring(0, 1000)}...
        
        Target Structure Context:
        ${targetEnrichment.knowledgeSynthesis.substring(0, 1000)}...
        `;
        
        console.log(`Found ${sourceEnrichment.documents.length} relevant documents for source and ${targetEnrichment.documents.length} for target`);
        console.log(`Found ${sourceEnrichment.fields.length} relevant fields for source and ${targetEnrichment.fields.length} for target`);
      }
    }
    
    const sourceEmbedded = await this.embedDataStructure(sourceStructure);
    const targetEmbedded = await this.embedDataStructure(targetStructure);

    const mappings = [];

    // Map each source field to the most similar target field
    for (const sourceField of sourceEmbedded.embeddings.fields) {
      const similarTargets = findSimilarVectors(
        sourceField.vector,
        targetEmbedded.embeddings.fields.map(field => ({ 
          vector: field.vector, 
          metadata: field
        })),
        3 // Get top 3 matches
      );

      mappings.push({
        sourceField: sourceField.field,
        targetMatches: similarTargets.map(match => ({
          targetField: match.metadata.field,
          confidence: match.similarity
        }))
      });
    }

    // Generate mapping description for prompt
    const mappingDescription = mappings.map(mapping => 
      `Source: ${mapping.sourceField} -> Target: ${mapping.targetMatches[0].targetField} (confidence: ${mapping.targetMatches[0].confidence.toFixed(2)})`
    ).join('\n');

    // Modified prompt to include vector database knowledge and request C# code with AutoMapper
    const prompt = `Based on the following mapping between source and target data structures, 
      generate C# code using AutoMapper to transform data from the source format to the target format.
      
      Field Mappings:
      ${mappingDescription}
      
      Source structure:
      ${JSON.stringify(sourceStructure.structure, null, 2)}
      
      Target structure:
      ${JSON.stringify(targetStructure.structure, null, 2)}
      
      ${vectorKnowledgeContext}
      
      Instructions:
      1. Create C# classes for both the source and target structures
      2. Define an AutoMapper profile class that configures the mappings
      3. Include a sample implementation showing how to use the mapper
      4. Add appropriate comments explaining the mapping logic
      5. Handle nested objects and arrays properly
      6. Include any necessary type conversions
      7. Return the complete C# solution including necessary using statements
      
      The output should be complete, compilable C# code that someone could directly use in a .NET project.`;

    const mappingCode = await this.ollama.generate(prompt);

    return {
      sourceStructure,
      targetStructure,
      fieldMappings: mappings,
      sourceEnrichment,
      targetEnrichment,
      mappingCode
    };
  }

  /**
   * Extract knowledge from vector database documents
   * @param {string} query - The query to search for in the vector database
   * @param {number} topK - Number of most relevant documents to retrieve
   * @returns {Object} Knowledge extracted from the documents
   */
  async extractKnowledgeFromVectorDB(query, topK = 5) {
    if (!this.initialized || this.vectorStore.length === 0) {
      throw new Error('Vector database is not initialized or empty');
    }

    // Embed the query to find similar documents and fields
    const queryEmbedding = await this.embedder.embedText(query);
    
    // Find similar documents in the vector store
    const similarDocuments = findSimilarVectors(
      queryEmbedding,
      this.vectorStore.filter(item => item.metadata.type === 'document'),
      topK
    );
    
    // Find similar fields in the vector store (regardless of which document they're from)
    const similarFields = findSimilarVectors(
      queryEmbedding,
      this.vectorStore.filter(item => item.metadata.type === 'field'),
      topK * 2 // Get more field matches for comprehensive coverage
    );
    
    if (similarDocuments.length === 0 && similarFields.length === 0) {
      return { 
        fields: [], 
        documents: [],
        description: "No relevant information found in the vector database" 
      };
    }
    
    // Extract content from relevant documents
    const relevantDocuments = await Promise.all(
      similarDocuments.map(async doc => {
        try {
          // Read the document content
          const content = await fs.readFile(doc.metadata.path, 'utf-8');
          return {
            filename: doc.metadata.filename,
            path: doc.metadata.path,
            content,
            similarity: doc.similarity
          };
        } catch (error) {
          console.error(`Error reading document ${doc.metadata.path}:`, error);
          return null;
        }
      })
    );
    
    const validDocuments = relevantDocuments.filter(doc => doc !== null);
    
    // Group similar fields by document
    const fieldsByDocument = {};
    similarFields.forEach(field => {
      const docPath = field.metadata.path;
      if (!fieldsByDocument[docPath]) {
        fieldsByDocument[docPath] = [];
      }
      fieldsByDocument[docPath].push({
        field: field.metadata.field,
        similarity: field.similarity
      });
    });
    
    // Extract descriptions from the fields for each document
    const documentDescriptions = await Promise.all(
      Object.entries(fieldsByDocument).map(async ([docPath, fields]) => {
        try {
          const content = await fs.readFile(docPath, 'utf-8');
          const docName = path.basename(docPath);
          
          // Extract field descriptions from the document
          let fieldDescriptions = '';
          fields.forEach(field => {
            // Simple extract for each field - search for the field name in the content
            const fieldRegex = new RegExp(`${field.field}[\\s:]+([^\\n]+)`, 'i');
            const match = content.match(fieldRegex);
            
            if (match && match[1]) {
              fieldDescriptions += `${field.field}: ${match[1].trim()}\n`;
            } else {
              fieldDescriptions += `${field.field}: (No description found)\n`;
            }
          });
          
          return {
            document: docName,
            path: docPath,
            fields: fields.map(f => f.field),
            descriptions: fieldDescriptions
          };
        } catch (error) {
          console.error(`Error processing fields for ${docPath}:`, error);
          return null;
        }
      })
    );
    
    const validFieldDescriptions = documentDescriptions.filter(desc => desc !== null);
    
    // Use the LLM to synthesize knowledge from all relevant information
    const synthesisPrompt = `
      Based on the following documents and fields from a vector database, extract a comprehensive data structure description.
      
      Relevant Documents:
      ${validDocuments.map(doc => `Document: ${doc.filename} (relevance: ${doc.similarity.toFixed(2)})
      ${doc.content.substring(0, 500)}... (truncated)
      
      `).join('\n')}
      
      Relevant Fields and Descriptions:
      ${validFieldDescriptions.map(desc => `Document: ${desc.document}
      Fields:
      ${desc.descriptions}
      
      `).join('\n')}
      
      Based on this information:
      1. Identify all fields and their descriptions
      2. Determine data types for each field
      3. Identify relationships between fields
      4. Create a comprehensive data structure description
      
      Structure your response to have two sections:
      1. A formal schema representation
      2. A natural language description of the data structure
    `;
    
    const synthesis = await this.ollama.generate(synthesisPrompt);
    
    // Extract structured knowledge from the synthesis
    const extractedStructure = await this.parseMixedContent(synthesis);
    
    return {
      documents: validDocuments.map(doc => ({
        filename: doc.filename,
        path: doc.path,
        similarity: doc.similarity
      })),
      fields: validFieldDescriptions.flatMap(desc => 
        desc.fields.map(field => ({ document: desc.document, field }))
      ),
      knowledgeSynthesis: synthesis,
      extractedStructure
    };
  }

  /**
   * Analyze a query against the vector database and extract relevant information
   * @param {string} query - The query to analyze
   * @returns {Object} Analysis results
   */
  async analyzeWithVectorDB(query) {
    if (!this.initialized) {
      throw new Error('DataMapper not initialized. Call loadDataFiles first.');
    }
    
    // Extract knowledge from vector database
    const knowledge = await this.extractKnowledgeFromVectorDB(query, 5);
    
    // Use LLM to analyze the query in context of the vector database knowledge
    const analysisPrompt = `
      Analyze the following query in the context of the extracted knowledge from the vector database:
      
      Query: ${query}
      
      Knowledge from Vector Database:
      ${knowledge.knowledgeSynthesis}
      
      Please provide:
      1. An explanation of what data structures might be relevant to this query
      2. Suggestions for what source and target mappings might be useful
      3. Key fields that should be included in any mapping
      4. Any potential challenges or considerations for data transformation
    `;
    
    const analysis = await this.ollama.generate(analysisPrompt);
    
    return {
      query,
      vectorKnowledge: knowledge,
      analysis
    };
  }
}

module.exports = DataMapper;
