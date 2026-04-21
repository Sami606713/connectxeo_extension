#!/usr/bin/env bash
set -e

echo "=== Ollama Deep Agent — Setup ==="

# 1. Check Ollama
if ! command -v ollama &>/dev/null; then
  echo "[!] Ollama not found. Install from https://ollama.com"
  exit 1
fi
echo "[✓] Ollama found"

# 2. Install deepagents-cli with ollama support
if command -v uv &>/dev/null; then
  echo "[*] Installing deepagents-cli via uv..."
  uv tool install 'deepagents-cli[ollama]'
elif command -v pip3 &>/dev/null; then
  echo "[*] Installing deepagents-cli via pip..."
  pip3 install 'deepagents-cli[ollama]'
else
  echo "[!] Neither uv nor pip3 found. Install uv: https://docs.astral.sh/uv/"
  exit 1
fi
echo "[✓] deepagents-cli installed"

# 3. Write ~/.deepagents/config.toml with Ollama provider
CONF_DIR="$HOME/.deepagents"
mkdir -p "$CONF_DIR"

cat > "$CONF_DIR/config.toml" <<'EOF'
# Ollama Deep Agent — generated config

[models.providers.ollama]
models = [
  "qwen2.5-coder:7b",
  "qwen2.5-coder:14b",
  "qwen3:8b",
  "deepseek-coder:6.7b",
  "deepseek-r1:7b",
  "llama3.2:3b",
  "llama3.3:70b",
  "codestral:22b",
  "mistral:7b",
  "gemma3:9b",
  "phi4:14b",
]
base_url = "http://localhost:11434"

[models.providers.ollama.params]
temperature = 0.1

# Default model
[models]
default = "ollama:qwen2.5-coder:7b"
EOF

echo "[✓] Config written to $CONF_DIR/config.toml"

# 4. Pull a starter model if none exist
INSTALLED=$(ollama list 2>/dev/null | tail -n +2 | wc -l)
if [ "$INSTALLED" -eq 0 ]; then
  echo "[*] No models found. Pulling qwen2.5-coder:7b (recommended for coding)..."
  ollama pull qwen2.5-coder:7b
  echo "[✓] Model pulled"
else
  echo "[✓] $INSTALLED Ollama model(s) already installed"
fi

echo ""
echo "=== Setup complete! ==="
echo "Open VS Code, install the extension, and start coding."
