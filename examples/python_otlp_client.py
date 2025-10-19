#!/usr/bin/env python3
"""
Example Python client that sends OpenTelemetry traces to Simple Traces collector.

This demonstrates how to instrument a Python application to send traces to the
Simple Traces OpenTelemetry collector.

Requirements:
    pip install opentelemetry-api opentelemetry-sdk opentelemetry-exporter-otlp-proto-http

Usage:
    python examples/python_otlp_client.py
    # Or with custom endpoint:
    OTLP_ENDPOINT=http://localhost:8080/v1/traces python examples/python_otlp_client.py
"""

from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
import time
import os

def main():
    # Get endpoint from environment or use default
    endpoint = os.getenv("OTLP_ENDPOINT", "http://localhost:8080/v1/traces")
    
    # Create a resource with service information
    resource = Resource.create({
        "service.name": "python-llm-app",
        "service.version": "1.0.0",
    })

    # Set up the tracer provider
    trace.set_tracer_provider(TracerProvider(resource=resource))
    tracer = trace.get_tracer(__name__)

    # Configure OTLP exporter to send to Simple Traces collector
    otlp_exporter = OTLPSpanExporter(
        endpoint=endpoint,
    )

    # Add the exporter to the tracer provider
    span_processor = BatchSpanProcessor(otlp_exporter)
    trace.get_tracer_provider().add_span_processor(span_processor)

    print(f"Sending traces to Simple Traces collector at {endpoint}...")


    # Example 1: LLM request with standard LLM attributes
    with tracer.start_as_current_span("llm-chat-completion") as span:
        span.set_attribute("llm.model", "gpt-4")
        span.set_attribute("llm.input", "What is the meaning of life?")
        span.set_attribute("llm.output", "The meaning of life is a profound philosophical question that has been pondered throughout human history. Some say it's 42!")
        span.set_attribute("llm.usage.prompt_tokens", 10)
        span.set_attribute("llm.usage.completion_tokens", 28)
        span.set_attribute("llm.temperature", 0.7)
        span.set_attribute("llm.max_tokens", 100)
        time.sleep(0.1)  # Simulate processing time

    print("✓ Sent trace with LLM attributes")

    # Example 2: LLM request with Gen AI semantic conventions
    with tracer.start_as_current_span("gen-ai-completion") as span:
        span.set_attribute("gen_ai.request.model", "gpt-3.5-turbo")
        span.set_attribute("gen_ai.prompt", "Explain quantum computing in simple terms")
        span.set_attribute("gen_ai.response", "Quantum computing uses quantum mechanics principles to perform calculations...")
        span.set_attribute("gen_ai.usage.input_tokens", 8)
        span.set_attribute("gen_ai.usage.output_tokens", 15)
        span.set_attribute("gen_ai.system", "openai")
        time.sleep(0.05)

    print("✓ Sent trace with Gen AI semantic conventions")

    # Example 3: Multiple nested spans
    with tracer.start_as_current_span("conversation") as parent_span:
        parent_span.set_attribute("conversation.id", "conv-123")
        
        with tracer.start_as_current_span("message-1") as span1:
            span1.set_attribute("llm.model", "claude-2")
            span1.set_attribute("llm.input", "Hello!")
            span1.set_attribute("llm.output", "Hi there! How can I help you?")
            span1.set_attribute("llm.usage.prompt_tokens", 2)
            span1.set_attribute("llm.usage.completion_tokens", 8)
            time.sleep(0.05)
        
        with tracer.start_as_current_span("message-2") as span2:
            span2.set_attribute("llm.model", "claude-2")
            span2.set_attribute("llm.input", "What's the weather like?")
            span2.set_attribute("llm.output", "I don't have access to real-time weather data.")
            span2.set_attribute("llm.usage.prompt_tokens", 6)
            span2.set_attribute("llm.usage.completion_tokens", 12)
            time.sleep(0.05)

    print("✓ Sent nested conversation traces")

    # Ensure all spans are exported before exiting
    print("\nShutting down tracer provider...")
    try:
        trace.get_tracer_provider().shutdown()
        print("✓ Tracer provider shutdown successfully")
    except Exception as e:
        print(f"⚠ Warning: Error during shutdown: {e}")
        print("  Some traces may not have been fully exported")
    
    print("\n✅ All traces sent successfully!")
    print("View them at: http://localhost:8080")

if __name__ == "__main__":
    main()
