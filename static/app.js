const messagesEl = document.getElementById("messages");
const formEl = document.getElementById("chatForm");
const inputEl = document.getElementById("messageInput");
const sendButtonEl = document.getElementById("sendButton");
const providerInputEl = document.getElementById("providerInput");
const modelInputEl = document.getElementById("modelInput");
const systemPromptEl = document.getElementById("systemPrompt");
const statusPillEl = document.getElementById("statusPill");
const copyChatButtonEl = document.getElementById("copyChatButton");
const themeToggleButtonEl = document.getElementById("themeToggleButton");
const newChatButtonEl = document.getElementById("newChatButton");
const messageTemplate = document.getElementById("messageTemplate");

const STORAGE_KEY = "python-chatgpt-clone-state";

let state = loadState();
let pendingReply = false;
let copiedMessageIndex = null;
let copiedChatTimeout = null;

const MODEL_OPTIONS = {
  ollama: ["llama3.2"],
  openrouter: [
    "deepseek/deepseek-chat-v3.1",
    "google/gemma-3-27b-it",
    "openai/gpt-oss-120b",
    "openai/gpt-4.1-mini",
  ],
  openai: ["gpt-4.1-mini"],
};

function getDefaultModelForProvider(provider) {
  if (provider === "ollama") return "llama3.2";
  if (provider === "openrouter") return "deepseek/deepseek-chat-v3.1";
  return "gpt-4.1-mini";
}

function loadState() {
  const fallback = {
    provider: "ollama",
    model: getDefaultModelForProvider("ollama"),
    theme: "light",
    systemPrompt:
      "You are a helpful, friendly AI assistant in a ChatGPT-style web app. Be clear, concise, and practical.",
    messages: [],
  };

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return fallback;
    }
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function setStatus(text) {
  statusPillEl.textContent = text;
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  const isDark = state.theme === "dark";
  themeToggleButtonEl.setAttribute("aria-pressed", String(isDark));
  themeToggleButtonEl.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
  themeToggleButtonEl.setAttribute("title", isDark ? "Switch to light mode" : "Switch to dark mode");
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderInlineMarkdown(text) {
  let result = escapeHtml(text);
  result = result.replace(/`([^`]+)`/g, "<code>$1</code>");
  result = result.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  result = result.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  result = result.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  return result;
}

function isTableBlock(lines) {
  if (lines.length < 2) {
    return false;
  }
  const hasPipe = lines.every((line) => line.includes("|"));
  const separator = /^\s*\|?[\s:-|]+\|?\s*$/;
  return hasPipe && separator.test(lines[1]);
}

function renderTable(block) {
  const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
  if (!isTableBlock(lines)) {
    return `<p>${renderInlineMarkdown(block)}</p>`;
  }

  const parseRow = (line) =>
    line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());

  const headers = parseRow(lines[0]);
  const rows = lines.slice(2).map(parseRow);

  const headHtml = headers.map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`).join("");
  const bodyHtml = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${renderInlineMarkdown(cell)}</td>`).join("")}</tr>`)
    .join("");

  return `<div class="table-wrap"><table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
}

function renderMarkdown(text) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return "";
  }

  const codeBlocks = [];
  const withCodePlaceholders = normalized.replace(/```([\s\S]*?)```/g, (_, code) => {
    const placeholder = `@@CODEBLOCK${codeBlocks.length}@@`;
    codeBlocks.push(`<pre><code>${escapeHtml(code.trim())}</code></pre>`);
    return placeholder;
  });

  const blocks = withCodePlaceholders.split(/\n{2,}/);
  const html = blocks.map((block) => {
    const trimmedBlock = block.trim();
    if (!trimmedBlock) {
      return "";
    }

    if (trimmedBlock.startsWith("@@CODEBLOCK")) {
      return trimmedBlock;
    }

    if (isTableBlock(trimmedBlock.split("\n"))) {
      return renderTable(trimmedBlock);
    }

    const lines = trimmedBlock.split("\n");

    if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
      const items = lines.map((line) => line.replace(/^\s*[-*]\s+/, "").trim());
      return `<ul>${items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ul>`;
    }

    if (lines.every((line) => /^\s*\d+\.\s+/.test(line))) {
      const items = lines.map((line) => line.replace(/^\s*\d+\.\s+/, "").trim());
      return `<ol>${items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ol>`;
    }

    if (/^###\s+/.test(trimmedBlock)) {
      return `<h3>${renderInlineMarkdown(trimmedBlock.replace(/^###\s+/, ""))}</h3>`;
    }
    if (/^##\s+/.test(trimmedBlock)) {
      return `<h2>${renderInlineMarkdown(trimmedBlock.replace(/^##\s+/, ""))}</h2>`;
    }
    if (/^#\s+/.test(trimmedBlock)) {
      return `<h1>${renderInlineMarkdown(trimmedBlock.replace(/^#\s+/, ""))}</h1>`;
    }

    return `<p>${lines.map((line) => renderInlineMarkdown(line)).join("<br>")}</p>`;
  }).join("");

  return codeBlocks.reduce((output, blockHtml, index) => output.replace(`@@CODEBLOCK${index}@@`, blockHtml), html);
}

function formatTranscript() {
  return state.messages
    .map((message) => `${message.role === "user" ? "You" : "Assistant"}:\n${message.content}`)
    .join("\n\n");
}

async function copyText(text) {
  if (!text) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const helper = document.createElement("textarea");
    helper.value = text;
    helper.setAttribute("readonly", "");
    helper.style.position = "absolute";
    helper.style.left = "-9999px";
    document.body.appendChild(helper);
    helper.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(helper);
    return copied;
  }
}

function renderMessages() {
  messagesEl.innerHTML = "";

  if (!state.messages.length) {
    const emptyNode = messageTemplate.content.firstElementChild.cloneNode(true);
    emptyNode.classList.add("empty-state");
    emptyNode.querySelector(".message-role").textContent = "Ready";
    emptyNode.querySelector(".message-copy").remove();
    emptyNode.querySelector(".message-body").textContent = "Start the conversation, switch themes, and copy replies as you go.";
    messagesEl.appendChild(emptyNode);
  } else {
    state.messages.forEach((message, index) => {
      const node = messageTemplate.content.firstElementChild.cloneNode(true);
      node.classList.add(message.role);
      node.querySelector(".message-role").textContent = message.role === "user" ? "You" : "Assistant";
      const bodyEl = node.querySelector(".message-body");
      if (message.role === "assistant") {
        bodyEl.innerHTML = renderMarkdown(message.content);
      } else {
        bodyEl.textContent = message.content;
      }
      const copyButton = node.querySelector(".message-copy");
      copyButton.dataset.messageIndex = String(index);
      copyButton.textContent = copiedMessageIndex === index ? "Copied" : "Copy";
      messagesEl.appendChild(node);
    });
  }

  if (pendingReply) {
    const node = messageTemplate.content.firstElementChild.cloneNode(true);
    node.classList.add("assistant", "pending");
    node.querySelector(".message-role").textContent = "Assistant";
    node.querySelector(".message-copy").remove();
    node.querySelector(".message-body").innerHTML = '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';
    messagesEl.appendChild(node);
  }

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderModelSuggestions() {
  const options = MODEL_OPTIONS[state.provider] || [];
  modelInputEl.innerHTML = "";
  options.forEach((model) => {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    if (model === state.model) {
      option.selected = true;
    }
    modelInputEl.appendChild(option);
  });
}

function syncInputsFromState() {
  providerInputEl.value = state.provider;
  systemPromptEl.value = state.systemPrompt;
  renderModelSuggestions();
}

function autosizeTextarea() {
  inputEl.style.height = "auto";
  inputEl.style.height = `${Math.min(inputEl.scrollHeight, 220)}px`;
}

async function sendMessage() {
  const content = inputEl.value.trim();
  if (!content || pendingReply) {
    return;
  }

  state.provider = providerInputEl.value;
  state.model = modelInputEl.value || getDefaultModelForProvider(state.provider);
  state.systemPrompt = systemPromptEl.value.trim();
  state.messages.push({ role: "user", content });
  saveState();
  renderMessages();

  inputEl.value = "";
  autosizeTextarea();
  setStatus("Thinking...");
  pendingReply = true;
  sendButtonEl.disabled = true;
  renderMessages();

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        provider: state.provider,
        model: state.model,
        systemPrompt: state.systemPrompt,
        messages: state.messages,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Request failed.");
    }

    state.messages.push({ role: "assistant", content: data.reply });
    saveState();
    setStatus(data.demoMode ? "Demo mode" : `Using ${data.provider}: ${data.model}`);
  } catch (error) {
    state.messages.push({
      role: "assistant",
      content: `Error: ${error.message}`,
    });
    saveState();
    setStatus("Request failed");
  } finally {
    pendingReply = false;
    renderMessages();
    sendButtonEl.disabled = false;
    inputEl.focus();
  }
}

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  await sendMessage();
});

inputEl.addEventListener("keydown", async (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    await sendMessage();
  }
});

inputEl.addEventListener("input", autosizeTextarea);

messagesEl.addEventListener("click", async (event) => {
  const button = event.target.closest(".message-copy");
  if (!button) {
    return;
  }

  const index = Number(button.dataset.messageIndex);
  const message = state.messages[index];
  const copied = await copyText(message?.content || "");
  if (!copied) {
    setStatus("Copy failed");
    return;
  }

  copiedMessageIndex = index;
  renderMessages();
  setStatus("Message copied");
  window.setTimeout(() => {
    if (copiedMessageIndex === index) {
      copiedMessageIndex = null;
      renderMessages();
    }
  }, 1400);
});

providerInputEl.addEventListener("change", () => {
  state.provider = providerInputEl.value;
  const fallbackModel = getDefaultModelForProvider(state.provider);
  const allowedModels = MODEL_OPTIONS[state.provider] || [];
  const currentModel = modelInputEl.value;
  state.model = allowedModels.includes(currentModel) ? currentModel : fallbackModel;
  renderModelSuggestions();
  saveState();
});

modelInputEl.addEventListener("change", () => {
  state.model = modelInputEl.value || getDefaultModelForProvider(state.provider);
  saveState();
});

systemPromptEl.addEventListener("change", () => {
  state.systemPrompt = systemPromptEl.value.trim();
  saveState();
});

copyChatButtonEl.addEventListener("click", async () => {
  const copied = await copyText(formatTranscript());
  if (!copied) {
    setStatus("Copy failed");
    return;
  }

  copyChatButtonEl.textContent = "Copied Chat";
  setStatus("Chat copied");
  window.clearTimeout(copiedChatTimeout);
  copiedChatTimeout = window.setTimeout(() => {
    copyChatButtonEl.textContent = "Copy Chat";
  }, 1400);
});

themeToggleButtonEl.addEventListener("click", () => {
  state.theme = state.theme === "dark" ? "light" : "dark";
  saveState();
  applyTheme();
});

newChatButtonEl.addEventListener("click", () => {
  state.messages = [];
  saveState();
  renderMessages();
  setStatus("Ready");
  inputEl.focus();
});

syncInputsFromState();
applyTheme();
renderMessages();
autosizeTextarea();
setStatus("Ready");
