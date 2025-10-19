// Example OpenTelemetry client for sending traces to Simple Traces via OTLP
// This example uses the @opentelemetry/sdk-trace-node and @opentelemetry/exporter-trace-otlp-http packages

const { Resource } = require('@opentelemetry/resources');
const { SEMRESATTRS_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { trace } = require('@opentelemetry/api');

// Configuration
const SERVICE_NAME = 'simple-traces-example';
const OTLP_ENDPOINT = 'http://localhost:8080/v1/traces';

/**
 * Initialize OpenTelemetry with OTLP exporter
 */
function initTracer() {
  // Create a resource identifying your service
  const resource = Resource.default().merge(
    new Resource({
      [SEMRESATTRS_SERVICE_NAME]: SERVICE_NAME,
    })
  );

  // Create OTLP trace exporter
  const exporter = new OTLPTraceExporter({
    url: OTLP_ENDPOINT,
    headers: {},
    concurrencyLimit: 10,
  });

  // Create tracer provider
  const provider = new NodeTracerProvider({
    resource: resource,
  });

  // Add span processor
  provider.addSpanProcessor(new SimpleSpanProcessor(exporter));

  // Register the provider
  provider.register();

  console.log('✓ OpenTelemetry initialized with OTLP exporter');
  console.log(`  Sending traces to: ${OTLP_ENDPOINT}`);

  return trace.getTracer(SERVICE_NAME);
}

/**
 * Example: Create a simple trace
 */
async function simpleTraceExample(tracer) {
  console.log('\n--- Simple Trace Example ---');
  
  const span = tracer.startSpan('llm.call');
  
  // Add LLM-specific attributes
  span.setAttribute('llm.model', 'gpt-4');
  span.setAttribute('llm.input', 'What is the capital of France?');
  span.setAttribute('llm.output', 'The capital of France is Paris.');
  span.setAttribute('llm.usage.prompt_tokens', 10);
  span.setAttribute('llm.usage.completion_tokens', 15);
  
  // Simulate some work
  await new Promise(resolve => setTimeout(resolve, 100));
  
  span.end();
  console.log('✓ Simple trace sent');
}

/**
 * Example: Create a trace with multiple spans (parent-child relationship)
 */
async function nestedTraceExample(tracer) {
  console.log('\n--- Nested Trace Example ---');
  
  const parentSpan = tracer.startSpan('llm.conversation');
  
  // First LLM call
  const span1 = tracer.startSpan('llm.call.1', { parent: parentSpan });
  span1.setAttribute('llm.model', 'gpt-3.5-turbo');
  span1.setAttribute('llm.input', 'Tell me a joke');
  span1.setAttribute('llm.output', 'Why did the chicken cross the road? To get to the other side!');
  span1.setAttribute('llm.usage.prompt_tokens', 5);
  span1.setAttribute('llm.usage.completion_tokens', 20);
  await new Promise(resolve => setTimeout(resolve, 80));
  span1.end();
  
  // Second LLM call
  const span2 = tracer.startSpan('llm.call.2', { parent: parentSpan });
  span2.setAttribute('llm.model', 'gpt-4');
  span2.setAttribute('llm.input', 'Explain that joke');
  span2.setAttribute('llm.output', 'The joke plays on the classic setup-punchline format...');
  span2.setAttribute('llm.usage.prompt_tokens', 8);
  span2.setAttribute('llm.usage.completion_tokens', 30);
  await new Promise(resolve => setTimeout(resolve, 120));
  span2.end();
  
  parentSpan.end();
  console.log('✓ Nested trace sent');
}

/**
 * Example: Create a trace with Gen AI semantic conventions
 */
async function genAITraceExample(tracer) {
  console.log('\n--- Gen AI Semantic Conventions Example ---');
  
  const span = tracer.startSpan('gen_ai.completion');
  
  // Gen AI semantic conventions
  span.setAttribute('gen_ai.system', 'openai');
  span.setAttribute('gen_ai.request.model', 'gpt-4-turbo');
  span.setAttribute('gen_ai.prompt', 'Translate "hello" to French');
  span.setAttribute('gen_ai.response', 'Bonjour');
  span.setAttribute('gen_ai.usage.input_tokens', 6);
  span.setAttribute('gen_ai.usage.output_tokens', 2);
  span.setAttribute('gen_ai.request.temperature', 0.7);
  span.setAttribute('gen_ai.request.max_tokens', 100);
  
  await new Promise(resolve => setTimeout(resolve, 90));
  
  span.end();
  console.log('✓ Gen AI trace sent');
}

/**
 * Example: Create a trace with events
 */
async function traceWithEventsExample(tracer) {
  console.log('\n--- Trace with Events Example ---');
  
  const span = tracer.startSpan('llm.streaming_call');
  
  span.setAttribute('llm.model', 'claude-3-opus');
  span.setAttribute('llm.input', 'Write a short poem');
  
  // Add events to show streaming progress
  span.addEvent('stream.started', {
    timestamp: Date.now(),
  });
  
  await new Promise(resolve => setTimeout(resolve, 50));
  span.addEvent('stream.chunk_received', {
    chunk: 1,
    content: 'Roses are red,',
  });
  
  await new Promise(resolve => setTimeout(resolve, 50));
  span.addEvent('stream.chunk_received', {
    chunk: 2,
    content: 'Violets are blue,',
  });
  
  await new Promise(resolve => setTimeout(resolve, 50));
  span.addEvent('stream.chunk_received', {
    chunk: 3,
    content: 'OpenTelemetry is great,',
  });
  
  await new Promise(resolve => setTimeout(resolve, 50));
  span.addEvent('stream.chunk_received', {
    chunk: 4,
    content: 'And so are you!',
  });
  
  span.addEvent('stream.completed', {
    total_chunks: 4,
  });
  
  span.setAttribute('llm.output', 'Roses are red, Violets are blue, OpenTelemetry is great, And so are you!');
  span.setAttribute('llm.usage.prompt_tokens', 7);
  span.setAttribute('llm.usage.completion_tokens', 18);
  
  span.end();
  console.log('✓ Trace with events sent');
}

/**
 * Main function
 */
async function main() {
  console.log('OpenTelemetry Simple Traces Example Client');
  console.log('===========================================\n');
  
  try {
    // Initialize tracer
    const tracer = initTracer();
    
    // Run examples
    await simpleTraceExample(tracer);
    await nestedTraceExample(tracer);
    await genAITraceExample(tracer);
    await traceWithEventsExample(tracer);
    
    // Wait a bit for all traces to be sent
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('\n✓ All examples completed!');
    console.log('Check the Simple Traces UI at http://localhost:8080 to see the traces.');
  } catch (error) {
    console.error('✗ Error:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { initTracer };
