from flask import Flask, request, jsonify
import logging
import os
from llama_cpp import Llama
import re
import json

# Basic Flask setup
app = Flask(__name__)

# Disable the default Flask logging to keep console clean
log = logging.getLogger('werkzeug')
log.setLevel(logging.ERROR)

# Add CORS headers to all responses
@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    response.headers['Access-Control-Allow-Methods'] = 'POST, GET, OPTIONS'
    return response

# Load the GGUF model once at startup
MODEL_PATH = "Mistral-7B-Instruct-v0.3-IQ4_XS.gguf"  # Update this path as needed
if not os.path.exists(MODEL_PATH):
    raise FileNotFoundError(f"GGUF model not found at {MODEL_PATH}")
llm = Llama(model_path=MODEL_PATH, n_ctx=2048, n_threads=4)

@app.route('/api/analyze', methods=['POST', 'OPTIONS'])
def analyze_actual():
    if request.method == 'OPTIONS':
        return jsonify({}), 200

    try:
        data = request.json
        if not data:
            return jsonify({'error': 'No input provided'}), 400

        prompt = f"[INST]Tell if the Twitter user described is a bot or human. Reply with either 'BOT' or 'HUMAN'\n{data}[/INST]"

        print(f"Sending prompt to model:\n{prompt}")

        response = llm(prompt, max_tokens=32, stop=["\n", "Q:", "Answer:"], echo=False)
        output = response["choices"][0]["text"].strip()

        print(f"Model response: {output}")

        classification = "BOT" if "BOT" in output.upper() else "HUMAN"

        return jsonify({
            'result': {
                'classification': classification,
                'raw_output': output
            }
        })

    except Exception as e:
        print(f"Error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/status', methods=['GET'])
def status():
    """Status endpoint"""
    return jsonify({
        'status': 'operational',
        'model': 'mistral-7B-instruct-v0.3-IQ4_XS',
    })

if __name__ == '__main__':
    print("Starting BOT detection server")
    print("Server running at http://localhost:5000")
    app.run(
        host='127.0.0.1',  
        port=5000,
        debug=False,
        ssl_context=None,  # No HTTPS
        threaded=True
    )