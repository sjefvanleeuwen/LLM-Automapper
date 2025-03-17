const path = require('path');
const fs = require('fs').promises;
const DataMapper = require('./services/data-mapper');

async function main() {
  try {
    // Initialize the data mapper
    const mapper = new DataMapper({
      ollamaBaseUrl: 'http://localhost:11434',
      ollamaModel: 'llama3',
      // Use Ollama for embeddings
      nomicModel: 'nomic-embed-text:latest' // This will be used as the Ollama embedding model
    });

    // Check if Ollama is running and has the llama3 model
    const args = process.argv.slice(2);
    const command = args[0];

    if (!command) {
      console.log('Usage:');
      console.log('  node index.js load <directory>  - Load and embed data files from a directory');
      console.log('  node index.js map <source> <target>  - Map fields between source and target files');
      console.log('  node index.js analyze <file>  - Analyze a plain text description');
      console.log('  node index.js query <text>  - Search the vector database for related information');
      return;
    }

    switch (command) {
      case 'load': {
        const directory = args[1] || './data';
        console.log(`Loading data files from ${directory}...`);
        
        const files = await fs.readdir(directory);
        const filePaths = files
          .filter(file => 
            file.endsWith('.json') || 
            file.endsWith('.csv') || 
            file.endsWith('.txt') || 
            file.endsWith('.md') ||
            file.endsWith('.yaml') ||
            file.endsWith('.yml'))
          .map(file => path.join(directory, file));
        
        if (filePaths.length === 0) {
          console.log('No compatible files found. Please add .json, .csv, .txt, .md, .yaml, or .yml files.');
          return;
        }
        
        console.log(`Found ${filePaths.length} files to process`);
        const structures = await mapper.loadDataFiles(filePaths);
        console.log(`Successfully processed ${structures.length} data structures`);
        
        // Save the processed structures for later use
        await fs.writeFile(
          path.join(directory, 'embedded-structures.json'),
          JSON.stringify(structures, null, 2)
        );
        console.log(`Embedded structures saved to ${path.join(directory, 'embedded-structures.json')}`);
        break;
      }
      
      case 'map': {
        const sourcePath = args[1];
        const targetPath = args[2];
        
        if (!sourcePath || !targetPath) {
          console.log('Please provide both source and target file paths');
          return;
        }
        
        console.log(`Mapping data from ${sourcePath} to ${targetPath}...`);
        
        // Load previously embedded structures if available
        const directory = path.dirname(sourcePath);
        try {
          const embeddedPath = path.join(directory, 'embedded-structures.json');
          const embeddedData = await fs.readFile(embeddedPath, 'utf-8');
          const structures = JSON.parse(embeddedData);
          console.log(`Loaded ${structures.length} embedded structures from cache`);
          
          // Initialize with the loaded structures
          await mapper.loadDataFiles([]);
          mapper.vectorStore = structures.flatMap(structure => [
            {
              vector: structure.embeddings.fullContent,
              metadata: {
                type: 'document',
                filename: structure.filename,
                path: structure.path
              }
            },
            ...structure.embeddings.fields.map(field => ({
              vector: field.vector,
              metadata: {
                type: 'field',
                field: field.field,
                filename: structure.filename,
                path: structure.path
              }
            }))
          ]);
          mapper.initialized = true;
        } catch (error) {
          console.log('No embedded structures found, proceeding with direct mapping');
          // Initialize with the source and target files
          await mapper.loadDataFiles([sourcePath, targetPath]);
        }
        
        const mapping = await mapper.mapDataStructures(sourcePath, targetPath);
        
        console.log('\nField Mappings:');
        mapping.fieldMappings.forEach(map => {
          console.log(`  ${map.sourceField} -> ${map.targetMatches[0].targetField} (confidence: ${map.targetMatches[0].confidence.toFixed(2)})`);
        });
        
        // Display any enrichment information from vector database
        if (mapping.sourceEnrichment || mapping.targetEnrichment) {
          console.log('\nEnrichment from Vector Database:');
          
          if (mapping.sourceEnrichment && mapping.sourceEnrichment.documents.length > 0) {
            console.log('  Source-related documents:');
            mapping.sourceEnrichment.documents.forEach(doc => {
              console.log(`    - ${doc.filename} (relevance: ${doc.similarity.toFixed(2)})`);
            });
          }
          
          if (mapping.targetEnrichment && mapping.targetEnrichment.documents.length > 0) {
            console.log('  Target-related documents:');
            mapping.targetEnrichment.documents.forEach(doc => {
              console.log(`    - ${doc.filename} (relevance: ${doc.similarity.toFixed(2)})`);
            });
          }
        }
        
        console.log('\nGenerated C# AutoMapper Code:');
        console.log(mapping.mappingCode);
        
        // Save the mapping to a .cs file for C# code
        const outputPath = path.join(
          path.dirname(sourcePath), 
          `Mapping${path.basename(sourcePath, path.extname(sourcePath))}To${path.basename(targetPath, path.extname(targetPath))}.cs`
        );
        await fs.writeFile(outputPath, mapping.mappingCode);
        console.log(`\nC# AutoMapper code saved to ${outputPath}`);
        break;
      }
      
      case 'analyze': {
        // New command to analyze a plain text description
        const filePath = args[1];
        
        if (!filePath) {
          console.log('Please provide a file path to analyze');
          return;
        }
        
        console.log(`Analyzing data structure in ${filePath}...`);
        
        try {
          // Initialize with minimal setup
          await mapper.loadDataFiles([]);
          mapper.initialized = true;
          
          // Parse the file
          const structure = await mapper.parseDataFile(filePath);
          
          console.log('\nExtracted Structure:');
          console.log(JSON.stringify(structure.structure, null, 2));
          
          // Save the extracted structure
          const outputPath = filePath + '.structure.json';
          await fs.writeFile(outputPath, JSON.stringify(structure.structure, null, 2));
          console.log(`\nExtracted structure saved to ${outputPath}`);
          
          // Get LLM to analyze the structure
          const analysisPrompt = `
            Analyze the following data structure and provide insights:
            1. What type of data does this appear to represent?
            2. What are the key entities and their relationships?
            3. Are there any potential issues or missing information?
            4. How might this data be best used or transformed?
            
            Data structure:
            ${JSON.stringify(structure.structure, null, 2)}
          `;
          
          const analysis = await mapper.ollama.generate(analysisPrompt);
          console.log('\nStructure Analysis:');
          console.log(analysis);
          
        } catch (error) {
          console.error('Error analyzing file:', error);
        }
        break;
      }
      
      case 'query': {
        // New command to query the vector database
        const query = args.slice(1).join(' ');
        
        if (!query || query.trim().length === 0) {
          console.log('Please provide a query to search for in the vector database');
          return;
        }
        
        console.log(`Querying vector database with: "${query}"`);
        
        try {
          // Load previously embedded structures if available
          const directory = args[1] && fs.existsSync(args[1]) ? args[1] : './data';
          try {
            const embeddedPath = path.join(directory, 'embedded-structures.json');
            const embeddedData = await fs.readFile(embeddedPath, 'utf-8');
            const structures = JSON.parse(embeddedData);
            console.log(`Loaded ${structures.length} embedded structures from vector database`);
            
            // Initialize with the loaded structures
            await mapper.loadDataFiles([]);
            mapper.vectorStore = structures.flatMap(structure => [
              {
                vector: structure.embeddings.fullContent,
                metadata: {
                  type: 'document',
                  filename: structure.filename,
                  path: structure.path
                }
              },
              ...structure.embeddings.fields.map(field => ({
                vector: field.vector,
                metadata: {
                  type: 'field',
                  field: field.field,
                  filename: structure.filename,
                  path: structure.path
                }
              }))
            ]);
            mapper.initialized = true;
          } catch (error) {
            console.error('Error loading vector database:', error);
            console.log('Please run "load" command first to build the vector database');
            return;
          }
          
          // Analyze the query against the vector database
          const analysis = await mapper.analyzeWithVectorDB(query);
          
          console.log('\nRelevant Documents:');
          if (analysis.vectorKnowledge.documents.length === 0) {
            console.log('  No relevant documents found');
          } else {
            analysis.vectorKnowledge.documents.forEach(doc => {
              console.log(`  - ${doc.filename} (relevance: ${doc.similarity.toFixed(2)})`);
            });
          }
          
          console.log('\nRelevant Fields:');
          if (analysis.vectorKnowledge.fields.length === 0) {
            console.log('  No relevant fields found');
          } else {
            // Group fields by document for better readability
            const fieldsByDoc = {};
            analysis.vectorKnowledge.fields.forEach(field => {
              if (!fieldsByDoc[field.document]) {
                fieldsByDoc[field.document] = [];
              }
              fieldsByDoc[field.document].push(field.field);
            });
            
            Object.entries(fieldsByDoc).forEach(([document, fields]) => {
              console.log(`  From ${document}:`);
              fields.forEach(field => {
                console.log(`    - ${field}`);
              });
            });
          }
          
          console.log('\nAnalysis:');
          console.log(analysis.analysis);
          
          // Save the analysis
          const outputPath = path.join('.', `query-analysis-${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
          const markdownContent = `# Vector Database Query Analysis
      
## Query
\`\`\`
${query}
\`\`\`

## Relevant Documents
${analysis.vectorKnowledge.documents.length === 0 ? 
  'No relevant documents found' : 
  analysis.vectorKnowledge.documents.map(doc => `- ${doc.filename} (relevance: ${doc.similarity.toFixed(2)})`).join('\n')}

## Relevant Fields
${Object.entries(analysis.vectorKnowledge.fields.reduce((acc, field) => {
  if (!acc[field.document]) {
    acc[field.document] = [];
  }
  acc[field.document].push(field.field);
  return acc;
}, {})).map(([document, fields]) => 
  `### From ${document}\n${fields.map(field => `- ${field}`).join('\n')}`
).join('\n\n')}

## Analysis
${analysis.analysis}

## Knowledge Synthesis
${analysis.vectorKnowledge.knowledgeSynthesis}
`;
          
          await fs.writeFile(outputPath, markdownContent);
          console.log(`\nDetailed analysis saved to ${outputPath}`);
          
        } catch (error) {
          console.error('Error querying vector database:', error);
        }
        break;
      }
      
      default:
        console.log(`Unknown command: ${command}`);
        console.log('Use "load" to process data files, "map" to map between structures, "analyze" to analyze a data description, or "query" to query the vector database');
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

main();