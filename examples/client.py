#!/usr/bin/env python3
"""
Example client for sending traces to Simple Traces API
"""

import json
import time
import requests

API_URL = "http://localhost:8080/api/traces"

def create_trace(model, input_text, output_text, prompt_tokens, output_tokens, duration_ms, metadata=None):
    """
    Create a new trace in Simple Traces
    
    Args:
        model: LLM model name (e.g., "gpt-4", "claude-3")
        input_text: User input/prompt
        output_text: Model output/response
        prompt_tokens: Number of tokens in the prompt
        output_tokens: Number of tokens in the output
        duration_ms: Duration in milliseconds
        metadata: Optional dictionary of additional metadata
    """
    payload = {
        "model": model,
        "input": input_text,
        "output": output_text,
        "prompt_tokens": prompt_tokens,
        "output_tokens": output_tokens,
        "duration": duration_ms,
    }
    
    if metadata:
        payload["metadata"] = metadata
    
    try:
        response = requests.post(API_URL, json=payload)
        response.raise_for_status()
        result = response.json()
        print(f"✓ Trace created: {result['id']}")
        return result
    except requests.exceptions.RequestException as e:
        print(f"✗ Error creating trace: {e}")
        return None

def main():
    """Example usage of the Simple Traces API"""
    
    # Example 1: Simple trace
    create_trace(
        model="gpt-4",
        input_text="What is machine learning?",
        output_text="Machine learning is a subset of artificial intelligence...",
        prompt_tokens=15,
        output_tokens=45,
        duration_ms=1200
    )
    
    # Example 2: Trace with metadata
    create_trace(
        model="claude-3-opus",
        input_text="Explain quantum computing in simple terms",
        output_text="Quantum computing uses quantum mechanics principles...",
        prompt_tokens=20,
        output_tokens=60,
        duration_ms=1500,
        metadata={
            "user_id": "user_12345",
            "session_id": "session_abc",
            "temperature": 0.7,
            "max_tokens": 100
        }
    )
    
    # Example 3: Multiple traces
    models = ["gpt-3.5-turbo", "gpt-4", "claude-3-sonnet"]
    for model in models:
        create_trace(
            model=model,
            input_text=f"Test prompt for {model}",
            output_text=f"Test response from {model}",
            prompt_tokens=10,
            output_tokens=25,
            duration_ms=800
        )
        time.sleep(0.1)  # Small delay between requests

if __name__ == "__main__":
    main()
