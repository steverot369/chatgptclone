import json
import mimetypes
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib import error, request


ROOT_DIR = Path(__file__).resolve().parent
STATIC_DIR = ROOT_DIR / "static"
ENV_FILE = ROOT_DIR / ".env"
OPENAI_API_URL = "https://api.openai.com/v1/responses"
DEFAULT_PROVIDER = os.environ.get("AI_PROVIDER", "ollama")
DEFAULT_MODEL = (
    os.environ.get("OLLAMA_MODEL")
    or os.environ.get("OPENROUTER_MODEL")
    or os.environ.get("OPENAI_MODEL", "llama3.2")
)
OLLAMA_API_URL = os.environ.get("OLLAMA_API_URL", "http://127.0.0.1:11434/api/chat")
OPENROUTER_API_URL = os.environ.get("OPENROUTER_API_URL", "https://openrouter.ai/api/v1/chat/completions")
OPENROUTER_MAX_TOKENS = int(os.environ.get("OPENROUTER_MAX_TOKENS", "2048"))
DEFAULT_SYSTEM_PROMPT = (
    "You are a helpful, friendly AI assistant in a ChatGPT-style web app. "
    "Be clear, concise, and practical."
)


def load_dotenv() -> None:
    if not ENV_FILE.is_file():
        return

    for raw_line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("\"'")
        if key and key not in os.environ:
            os.environ[key] = value


load_dotenv()


def build_demo_reply(messages: list[dict], system_prompt: str, provider: str) -> str:
    last_user_message = next(
        (message.get("content", "").strip() for message in reversed(messages) if message.get("role") == "user"),
        "",
    )
    if not last_user_message:
        return "Demo mode is active. Add a message and I will respond here."
    return (
        f"Demo mode is active because the `{provider}` backend is not configured or reachable.\n\n"
        f"You said: {last_user_message}\n\n"
        "To use real responses, start Ollama locally or configure a valid OpenAI API key and restart the server.\n"
        f"Current system prompt: {system_prompt}"
    )


def extract_output_text(response_data: dict) -> str:
    texts: list[str] = []
    for item in response_data.get("output", []):
        if item.get("type") != "message":
            continue
        for content in item.get("content", []):
            if content.get("type") == "output_text":
                text = content.get("text", "").strip()
                if text:
                    texts.append(text)
    if texts:
        return "\n".join(texts)
    raise ValueError("No assistant text was returned by the OpenAI response.")


def call_openai(messages: list[dict], system_prompt: str, model: str) -> str:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return build_demo_reply(messages, system_prompt, "openai")

    input_messages: list[dict] = []
    if system_prompt.strip():
        input_messages.append({"role": "system", "content": system_prompt.strip()})

    for message in messages:
        role = message.get("role")
        content = str(message.get("content", "")).strip()
        if role not in {"user", "assistant"} or not content:
            continue
        input_messages.append({"role": role, "content": content})

    if not any(message.get("role") == "user" for message in input_messages):
        raise ValueError("At least one user message is required.")

    payload = {
        "model": model or DEFAULT_MODEL,
        "input": input_messages,
    }

    req = request.Request(
        OPENAI_API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with request.urlopen(req, timeout=90) as response:
            response_data = json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenAI API error ({exc.code}): {details}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"Could not reach the OpenAI API: {exc.reason}") from exc

    return extract_output_text(response_data)


def call_ollama(messages: list[dict], system_prompt: str, model: str) -> str:
    input_messages: list[dict] = []
    if system_prompt.strip():
        input_messages.append({"role": "system", "content": system_prompt.strip()})

    for message in messages:
        role = message.get("role")
        content = str(message.get("content", "")).strip()
        if role not in {"user", "assistant"} or not content:
            continue
        input_messages.append({"role": role, "content": content})

    if not any(message.get("role") == "user" for message in input_messages):
        raise ValueError("At least one user message is required.")

    payload = {
        "model": model or os.environ.get("OLLAMA_MODEL", "llama3.2"),
        "messages": input_messages,
        "stream": False,
    }

    req = request.Request(
        OLLAMA_API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with request.urlopen(req, timeout=90) as response:
            response_data = json.loads(response.read().decode("utf-8"))
    except error.URLError:
        return build_demo_reply(messages, system_prompt, "ollama")
    except error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Ollama API error ({exc.code}): {details}") from exc

    reply = response_data.get("message", {}).get("content", "").strip()
    if not reply:
        raise RuntimeError("Ollama returned an empty response.")
    return reply


def call_openrouter(messages: list[dict], system_prompt: str, model: str) -> str:
    api_key = (os.environ.get("OPENROUTER_API_KEY") or "").strip()
    if not api_key or api_key == "your_openrouter_key_here":
        return build_demo_reply(messages, system_prompt, "openrouter")

    input_messages: list[dict] = []
    if system_prompt.strip():
        input_messages.append({"role": "system", "content": system_prompt.strip()})

    for message in messages:
        role = message.get("role")
        content = str(message.get("content", "")).strip()
        if role not in {"user", "assistant"} or not content:
            continue
        input_messages.append({"role": role, "content": content})

    if not any(message.get("role") == "user" for message in input_messages):
        raise ValueError("At least one user message is required.")

    payload = {
        "model": model or os.environ.get("OPENROUTER_MODEL", "openai/gpt-4.1-mini"),
        "messages": input_messages,
        "max_tokens": OPENROUTER_MAX_TOKENS,
    }

    req = request.Request(
        OPENROUTER_API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    app_url = os.environ.get("OPENROUTER_APP_URL", "").strip()
    app_name = os.environ.get("OPENROUTER_APP_NAME", "").strip()
    if app_url:
        req.add_header("HTTP-Referer", app_url)
    if app_name:
        req.add_header("X-OpenRouter-Title", app_name)

    try:
        with request.urlopen(req, timeout=90) as response:
            response_data = json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenRouter API error ({exc.code}): {details}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"Could not reach the OpenRouter API: {exc.reason}") from exc

    choices = response_data.get("choices", [])
    if not choices:
        raise RuntimeError("OpenRouter returned no choices.")

    reply = choices[0].get("message", {}).get("content", "").strip()
    if not reply:
        raise RuntimeError("OpenRouter returned an empty response.")
    return reply


def chat_with_provider(messages: list[dict], system_prompt: str, model: str, provider: str) -> tuple[str, bool]:
    selected_provider = (provider or DEFAULT_PROVIDER).strip().lower()
    if selected_provider == "openai":
        reply = call_openai(messages, system_prompt, model)
        return reply, reply.startswith("Demo mode is active")
    if selected_provider == "ollama":
        reply = call_ollama(messages, system_prompt, model)
        return reply, reply.startswith("Demo mode is active")
    if selected_provider == "openrouter":
        reply = call_openrouter(messages, system_prompt, model)
        return reply, reply.startswith("Demo mode is active")
    raise ValueError("Unsupported provider. Use `ollama`, `openrouter`, or `openai`.")


class ChatCloneHandler(BaseHTTPRequestHandler):
    server_version = "ChatClone/1.0"

    def do_GET(self) -> None:
        if self.path == "/":
            self.serve_file(STATIC_DIR / "index.html")
            return

        safe_path = self.path.lstrip("/")
        target = (STATIC_DIR / safe_path).resolve()
        if not str(target).startswith(str(STATIC_DIR.resolve())) or not target.is_file():
            self.send_error(HTTPStatus.NOT_FOUND, "File not found.")
            return
        self.serve_file(target)

    def do_POST(self) -> None:
        if self.path != "/api/chat":
            self.send_error(HTTPStatus.NOT_FOUND, "Route not found.")
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(content_length)
            payload = json.loads(raw_body.decode("utf-8"))

            messages = payload.get("messages", [])
            system_prompt = str(payload.get("systemPrompt") or DEFAULT_SYSTEM_PROMPT)
            model = str(payload.get("model") or DEFAULT_MODEL)
            provider = str(payload.get("provider") or DEFAULT_PROVIDER)

            if not isinstance(messages, list):
                raise ValueError("`messages` must be an array.")

            assistant_text, demo_mode = chat_with_provider(messages, system_prompt, model, provider)
            self.send_json(
                HTTPStatus.OK,
                {
                    "reply": assistant_text,
                    "model": model,
                    "provider": provider,
                    "demoMode": demo_mode,
                },
            )
        except json.JSONDecodeError:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Request body must be valid JSON."})
        except ValueError as exc:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except RuntimeError as exc:
            self.send_json(HTTPStatus.BAD_GATEWAY, {"error": str(exc)})
        except Exception as exc:  # pragma: no cover - defensive fallback for local server use
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"Unexpected server error: {exc}"})

    def serve_file(self, path: Path) -> None:
        content_type, _ = mimetypes.guess_type(path.name)
        body = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, status: HTTPStatus, data: dict) -> None:
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args) -> None:
        return


def run() -> None:
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer((host, port), ChatCloneHandler)
    print(f"ChatGPT clone running on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    run()
