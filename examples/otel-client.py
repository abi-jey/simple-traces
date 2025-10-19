#!/usr/bin/env python3
"""
Example OpenTelemetry client for sending traces to Simple Traces via OTLP
Requires: pip install opentelemetry-api opentelemetry-sdk opentelemetry-exporter-otlp-proto-http
"""

import time
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource

# Configuration
SERVICE_NAME = "simple-traces-python-example"
OTLP_ENDPOINT = "http://localhost:8080/v1/traces"


def init_tracer():
    """Initialize OpenTelemetry with OTLP exporter"""
    # Create a resource identifying your service
    resource = Resource.create({
        "service.name": SERVICE_NAME,
        "service.version": "1.0.0",
    })
    
    # Create OTLP exporter
    exporter = OTLPSpanExporter(
        endpoint=OTLP_ENDPOINT,
        headers={}
    )
    
    # Create tracer provider
    provider = TracerProvider(resource=resource)
    processor = BatchSpanProcessor(exporter)
    provider.add_span_processor(processor)
    
    # Register the provider
    trace.set_tracer_provider(provider)
    
    print(f"✓ OpenTelemetry initialized with OTLP exporter")
    print(f"  Sending traces to: {OTLP_ENDPOINT}")
    
    return trace.get_tracer(SERVICE_NAME)


def simple_trace_example(tracer):
    """Example: Create a simple LLM trace"""
    print("\n--- Simple Trace Example ---")
    
    with tracer.start_as_current_span("llm.call") as span:
        # Add LLM-specific attributes
        span.set_attribute("llm.model", "gpt-4")
        span.set_attribute("llm.input", "What is the capital of France?")
        span.set_attribute("llm.output", "The capital of France is Paris.")
        span.set_attribute("llm.usage.prompt_tokens", 10)
        span.set_attribute("llm.usage.completion_tokens", 15)
        
        # Simulate some work
        time.sleep(0.1)
    
    print("✓ Simple trace sent")


def nested_trace_example(tracer):
    """Example: Create a trace with nested spans"""
    print("\n--- Nested Trace Example ---")
    
    with tracer.start_as_current_span("llm.conversation") as parent_span:
        # First LLM call
        with tracer.start_as_current_span("llm.call.1") as span1:
            span1.set_attribute("llm.model", "gpt-3.5-turbo")
            span1.set_attribute("llm.input", "Tell me a joke")
            span1.set_attribute("llm.output", "Why did the chicken cross the road? To get to the other side!")
            span1.set_attribute("llm.usage.prompt_tokens", 5)
            span1.set_attribute("llm.usage.completion_tokens", 20)
            time.sleep(0.08)
        
        # Second LLM call
        with tracer.start_as_current_span("llm.call.2") as span2:
            span2.set_attribute("llm.model", "gpt-4")
            span2.set_attribute("llm.input", "Explain that joke")
            span2.set_attribute("llm.output", "The joke plays on the classic setup-punchline format...")
            span2.set_attribute("llm.usage.prompt_tokens", 8)
            span2.set_attribute("llm.usage.completion_tokens", 30)
            time.sleep(0.12)
    
    print("✓ Nested trace sent")


def gen_ai_trace_example(tracer):
    """Example: Create a trace with Gen AI semantic conventions"""
    print("\n--- Gen AI Semantic Conventions Example ---")
    
    with tracer.start_as_current_span("gen_ai.completion") as span:
        # Gen AI semantic conventions
        span.set_attribute("gen_ai.system", "openai")
        span.set_attribute("gen_ai.request.model", "gpt-4-turbo")
        span.set_attribute("gen_ai.prompt", 'Translate "hello" to French')
        span.set_attribute("gen_ai.response", "Bonjour")
        span.set_attribute("gen_ai.usage.input_tokens", 6)
        span.set_attribute("gen_ai.usage.output_tokens", 2)
        span.set_attribute("gen_ai.request.temperature", 0.7)
        span.set_attribute("gen_ai.request.max_tokens", 100)
        
        time.sleep(0.09)
    
    print("✓ Gen AI trace sent")


def trace_with_events_example(tracer):
    """Example: Create a trace with events"""
    print("\n--- Trace with Events Example ---")
    
    with tracer.start_as_current_span("llm.streaming_call") as span:
        span.set_attribute("llm.model", "claude-3-opus")
        span.set_attribute("llm.input", "Write a short poem")
        
        # Add events to show streaming progress
        span.add_event("stream.started")
        
        time.sleep(0.05)
        span.add_event("stream.chunk_received", {
            "chunk": 1,
            "content": "Roses are red,"
        })
        
        time.sleep(0.05)
        span.add_event("stream.chunk_received", {
            "chunk": 2,
            "content": "Violets are blue,"
        })
        
        time.sleep(0.05)
        span.add_event("stream.chunk_received", {
            "chunk": 3,
            "content": "OpenTelemetry is great,"
        })
        
        time.sleep(0.05)
        span.add_event("stream.chunk_received", {
            "chunk": 4,
            "content": "And so are you!"
        })
        
        span.add_event("stream.completed", {"total_chunks": 4})
        
        span.set_attribute("llm.output", "Roses are red, Violets are blue, OpenTelemetry is great, And so are you!")
        span.set_attribute("llm.usage.prompt_tokens", 7)
        span.set_attribute("llm.usage.completion_tokens", 18)
    
    print("✓ Trace with events sent")


def main():
    """Main function"""
    print("OpenTelemetry Simple Traces Example Client (Python)")
    print("=" * 50)
    
    try:
        # Initialize tracer
        tracer = init_tracer()
        
        # Run examples
        simple_trace_example(tracer)
        nested_trace_example(tracer)
        gen_ai_trace_example(tracer)
        trace_with_events_example(tracer)
        
        # Wait for all traces to be sent
        time.sleep(2)
        
        print("\n✓ All examples completed!")
        print("Check the Simple Traces UI at http://localhost:8080 to see the traces.")
        
    except Exception as e:
        print(f"✗ Error: {e}")
        import traceback
        traceback.print_exc()
        exit(1)


if __name__ == "__main__":
    main()
