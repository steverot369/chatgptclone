# Python ChatGPT Clone

A lightweight ChatGPT-style web app built with Python and no third-party dependencies.

## Features

- Chat-style web interface
- Browser-side conversation history using `localStorage`
- Python backend with `POST /api/chat`
- Free local AI support with `Ollama`
- OpenRouter support
- Optional OpenAI Responses API integration
- Demo mode fallback when no backend is configured

## Run it

```powershell
python app.py
```

Open `http://127.0.0.1:8000`

## Free local mode with Ollama

Install Ollama and pull a model:

```powershell
ollama pull llama3.2
```

Set your `.env` like this:

```env
AI_PROVIDER=ollama
OLLAMA_MODEL=llama3.2
OLLAMA_API_URL=http://127.0.0.1:11434/api/chat
```

Then run:

```powershell
python app.py
```

## Optional OpenAI mode

Create a `.env` file in the project root:

```env
AI_PROVIDER=openai
OPENAI_API_KEY=your_api_key_here
OPENAI_MODEL=gpt-4.1-mini
```

Then run:

```powershell
python app.py
```

You can still use environment variables directly in PowerShell if you prefer:

PowerShell:

```powershell
$env:OPENAI_API_KEY="your_api_key_here"
$env:OPENAI_MODEL="gpt-4.1-mini"
python app.py
```

The backend calls `POST https://api.openai.com/v1/responses` and sends the current conversation as input messages.

## OpenRouter mode

Set your `.env` like this:

```env
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=your_openrouter_key_here
OPENROUTER_MODEL=openai/gpt-4.1-mini
OPENROUTER_API_URL=https://openrouter.ai/api/v1/chat/completions
```

Then run:

```powershell
python app.py
```

This uses OpenRouter's OpenAI-compatible chat completions endpoint and sends your conversation as `messages`.

## Notes

- The default provider is `ollama`.
- If Ollama is not running and no OpenAI key is set, the app still works in demo mode so you can test the UI.
- Chat history is stored in the browser, not on the server.
- You can change provider and model in the sidebar.
