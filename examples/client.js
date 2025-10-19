// Example Node.js client for sending traces to Simple Traces API

const API_URL = 'http://localhost:8080/api/traces';

/**
 * Create a new trace in Simple Traces
 */
async function createTrace({
  model,
  input,
  output,
  promptTokens,
  outputTokens,
  duration,
  metadata = null
}) {
  const payload = {
    model,
    input,
    output,
    prompt_tokens: promptTokens,
    output_tokens: outputTokens,
    duration
  };

  if (metadata) {
    payload.metadata = metadata;
  }

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log(`✓ Trace created: ${result.id}`);
    return result;
  } catch (error) {
    console.error(`✗ Error creating trace: ${error.message}`);
    return null;
  }
}

/**
 * Example usage
 */
async function main() {
  // Example 1: Simple trace
  await createTrace({
    model: 'gpt-4',
    input: 'What is machine learning?',
    output: 'Machine learning is a subset of artificial intelligence...',
    promptTokens: 15,
    outputTokens: 45,
    duration: 1200
  });

  // Example 2: Trace with metadata
  await createTrace({
    model: 'claude-3-opus',
    input: 'Explain quantum computing in simple terms',
    output: 'Quantum computing uses quantum mechanics principles...',
    promptTokens: 20,
    outputTokens: 60,
    duration: 1500,
    metadata: {
      user_id: 'user_12345',
      session_id: 'session_abc',
      temperature: 0.7,
      max_tokens: 100
    }
  });

  // Example 3: Multiple traces
  const models = ['gpt-3.5-turbo', 'gpt-4', 'claude-3-sonnet'];
  for (const model of models) {
    await createTrace({
      model,
      input: `Test prompt for ${model}`,
      output: `Test response from ${model}`,
      promptTokens: 10,
      outputTokens: 25,
      duration: 800
    });
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

main().catch(console.error);
