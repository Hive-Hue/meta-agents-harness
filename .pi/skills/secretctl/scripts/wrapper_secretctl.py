#!/usr/bin/env python3
"""
secretctl wrapper with multi-layer sanitization and secure placeholder expansion.

NEW: Supports {{SECRET_NAME}} placeholders that are expanded AFTER secret injection.
This allows using secrets in command arguments WITHOUT bash in allowlist.

Example:
  python3 wrapper run -k FIRECRAWL_API_KEY -- curl -H "Authorization: Bearer {{FIRECRAWL_API_KEY}}"
  
The wrapper will:
1. Inject FIRECRAWL_API_KEY into environment
2. Replace {{FIRECRAWL_API_KEY}} with actual value
3. Execute curl with the real value
"""
import os
import pty
import select
import subprocess
import sys
import termios
import tty
import hashlib
import shutil
import re
import base64
import json
from pathlib import Path
from datetime import datetime

# =============================================================================
# CONFIGURATION
# =============================================================================

BLOCKED_COMMANDS = {
    "get",
    "list",
    "delete",
    "secret_get",
    "secret_list",
    "secret_delete",
}
ALLOWED_COMMANDS = {"run"}
BLOCKED_RUN_FLAGS = {"--no-sanitize", "--no_sanitize"}
POLICY_PATH = os.path.expanduser("~/.secretctl/mcp-policy.yaml")
BLOCKED_CHILD_EXECUTORS = {
    "sh",
    "bash",
    "dash",
    "zsh",
    "fish",
    "python",
    "python3",
    "node",
    "perl",
    "ruby",
    "php",
    "lua",
}

# Placeholder pattern: {{SECRET_NAME}}
PLACEHOLDER_PATTERN = re.compile(r'\{\{([A-Z0-9_]+)\}\}')

# Sanitization configuration
SANITIZATION_CONFIG = {
    "enabled": True,
    "max_output_length": 5120,
    "max_output_lines": 200,
    "detect_base64": True,
    "detect_hex": True,
    "detect_fragments": True,
    "max_fragments": 10,
    "fragment_threshold": 0.7,
    "log_attempts": True,
    "log_path": os.path.expanduser("~/.secretctl/audit/sanitization.log"),
}

# Pre-compiled regex patterns
_BASE64_PATTERN = re.compile(r'[A-Za-z0-9+/]{20,}={0,2}')
_HEX_PATTERN = re.compile(r'[0-9a-fA-F]{40,}')
_HEX_MIXED_PATTERN = re.compile(r'(?:[0-9a-fA-F]{2}\s){10,}')
_FRAGMENT_PATTERNS = [
    re.compile(r'PART\d*:\s*(\S+)'),
    re.compile(r'\d+:\s*([a-zA-Z0-9\-]{2,4})'),
    re.compile(r'([a-zA-Z0-9\-]{1,2})(?:\|)+'),
    re.compile(r'([a-zA-Z0-9\-]{1,2})(?:\s)+'),
]


# =============================================================================
# PLACEHOLDER EXPANSION
# =============================================================================

def expand_placeholders(args, secrets):
    """
    Expand {{SECRET_NAME}} placeholders in command arguments.
    
    This is SAFE because:
    1. Secrets are already loaded in memory (from secretctl)
    2. Expansion happens just before exec
    3. No logging of expanded values
    4. Sanitization still applies to output
    
    Args:
        args: List of command arguments
        secrets: Dict of {secret_name: secret_value}
    
    Returns:
        List of arguments with placeholders expanded
    """
    expanded = []
    
    for arg in args:
        # Find all placeholders in this argument
        placeholders = PLACEHOLDER_PATTERN.findall(arg)
        
        if not placeholders:
            expanded.append(arg)
            continue
        
        # Replace each placeholder
        expanded_arg = arg
        for placeholder in placeholders:
            if placeholder in secrets:
                # Replace {{NAME}} with actual value
                expanded_arg = expanded_arg.replace(
                    f'{{{{{placeholder}}}}}',
                    secrets[placeholder]
                )
            else:
                # Placeholder not found - leave as is (will likely cause error)
                print(f"WARNING: Secret '{placeholder}' not found", file=sys.stderr)
        
        expanded.append(expanded_arg)
    
    return expanded


def load_secrets_for_expansion(key_patterns, password):
    secrets = {}
    for pattern in key_patterns:
        value = get_secret_value(pattern, password)
        if value:
            secrets[pattern] = value
    return secrets


def get_secret_value(pattern, password):
    cmd = ["secretctl", "get", pattern]
    master_fd, slave_fd = pty.openpty()
    attrs = termios.tcgetattr(slave_fd)
    attrs[3] = attrs[3] & ~termios.ECHO
    termios.tcsetattr(slave_fd, termios.TCSANOW, attrs)
    proc = subprocess.Popen(
        cmd,
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        env=os.environ.copy(),
        close_fds=True,
        text=True,
    )
    os.close(slave_fd)
    prompt_tokens = ("master password", "password:")
    chunks = []
    buffered = ""
    sent_password = False
    try:
        while True:
            ready, _, _ = select.select([master_fd], [], [], 0.1)
            if master_fd in ready:
                try:
                    data_bytes = os.read(master_fd, 1024)
                except OSError:
                    break
                if not data_bytes:
                    break
                data = data_bytes.decode("utf-8", errors="ignore")
                chunks.append(data)
                buffered += data.lower()
                if (not sent_password) and any(token in buffered for token in prompt_tokens):
                    os.write(master_fd, (password + "\n").encode())
                    sent_password = True
            if proc.poll() is not None:
                break
    finally:
        try:
            proc.wait(timeout=2)
        except Exception:
            pass
        os.close(master_fd)
    if proc.returncode != 0:
        return None
    output = "".join(chunks).replace("\r", "")
    lines = [line.strip() for line in output.split("\n") if line.strip()]
    values = [line for line in lines if "password" not in line.lower()]
    if not values:
        return None
    return values[-1]


# =============================================================================
# SANITIZATION FUNCTIONS (keep existing implementation)
# =============================================================================

def _normalize(text: str) -> str:
    return ''.join(c.lower() for c in text if c.isalnum() or c in '-_:')


def _log_sanitization_event(event_type: str, details: dict):
    if not SANITIZATION_CONFIG["log_attempts"]:
        return
    
    if event_type not in ["base64_detected", "hex_detected", "fragment_detected", 
                          "rate_limit_exceeded", "normalization_detected"]:
        return
    
    try:
        log_entry = {
            "timestamp": datetime.now().isoformat(),
            "event_type": event_type,
            "details": details,
        }
        
        log_path = SANITIZATION_CONFIG["log_path"]
        os.makedirs(os.path.dirname(log_path), exist_ok=True)
        
        with open(log_path, "a") as f:
            f.write(json.dumps(log_entry) + "\n")
    except Exception:
        pass


def _check_rate_limit(output: str) -> tuple:
    if len(output) > SANITIZATION_CONFIG["max_output_length"]:
        _log_sanitization_event("rate_limit_exceeded", {
            "reason": "length",
            "output_length": len(output),
            "max_length": SANITIZATION_CONFIG["max_output_length"],
        })
        return False, f"Output exceeds maximum length of {SANITIZATION_CONFIG['max_output_length']} bytes"
    
    lines = output.split('\n')
    if len(lines) > SANITIZATION_CONFIG["max_output_lines"]:
        _log_sanitization_event("rate_limit_exceeded", {
            "reason": "lines",
            "output_lines": len(lines),
            "max_lines": SANITIZATION_CONFIG["max_output_lines"],
        })
        return False, f"Output exceeds maximum of {SANITIZATION_CONFIG['max_output_lines']} lines"
    
    return True, ""


def _decode_and_check_base64(text: str, secrets: dict) -> str:
    for match in _BASE64_PATTERN.finditer(text):
        try:
            decoded = base64.b64decode(match.group()).decode('utf-8')
            
            if _BASE64_PATTERN.search(decoded):
                decoded = _decode_and_check_base64(decoded, secrets)
            
            for name, value in secrets.items():
                if value in decoded:
                    text = text.replace(match.group(), f'[REDACTED:{name}]')
                    _log_sanitization_event("base64_detected", {
                        "secret_name": name,
                        "encoded_length": len(match.group()),
                    })
        except:
            pass
    
    return text


def _decode_and_check_hex(text: str, secrets: dict) -> str:
    for match in _HEX_PATTERN.finditer(text):
        try:
            decoded = bytes.fromhex(match.group()).decode('utf-8')
            
            for name, value in secrets.items():
                if value in decoded:
                    text = text.replace(match.group(), f'[REDACTED:{name}]')
                    _log_sanitization_event("hex_detected", {
                        "secret_name": name,
                        "encoded_length": len(match.group()),
                    })
        except:
            pass
    
    for match in _HEX_MIXED_PATTERN.finditer(text):
        try:
            hex_clean = match.group().replace(' ', '')
            decoded = bytes.fromhex(hex_clean).decode('utf-8')
            
            for name, value in secrets.items():
                if value in decoded:
                    text = text.replace(match.group(), f'[REDACTED:{name}]')
                    _log_sanitization_event("hex_detected", {
                        "secret_name": name,
                        "encoded_length": len(match.group()),
                        "pattern": "hex_mixed",
                    })
        except:
            pass
    
    return text


def _contains_secret_fragments(secret: str, fragments: list) -> bool:
    reconstructed = ''.join(fragments)
    if secret in reconstructed:
        return True
    
    normalized_secret = _normalize(secret)
    normalized_reconstructed = _normalize(reconstructed)
    
    if normalized_secret in normalized_reconstructed:
        return True
    
    threshold = SANITIZATION_CONFIG["fragment_threshold"]
    secret_len = len(normalized_secret)
    match_len = 0
    
    for fragment in fragments:
        normalized_fragment = _normalize(fragment)
        if normalized_fragment in normalized_secret:
            match_len += len(normalized_fragment)
    
    if secret_len > 0 and (match_len / secret_len) >= threshold:
        return True
    
    return False


def _check_fragments(text: str, secrets: dict) -> str:
    for pattern in _FRAGMENT_PATTERNS:
        matches = pattern.findall(text)
        
        if len(matches) >= SANITIZATION_CONFIG["max_fragments"]:
            for name, value in secrets.items():
                if _contains_secret_fragments(value, matches):
                    for match in matches:
                        text = text.replace(match, f'[REDACTED:{name}]')
                    
                    _log_sanitization_event("fragment_detected", {
                        "secret_name": name,
                        "fragment_count": len(matches),
                        "pattern": pattern.pattern,
                    })
    
    return text


def _sanitize_output(output: str, secrets: dict) -> str:
    if not SANITIZATION_CONFIG["enabled"]:
        return output
    
    if len(output) < 20:
        for name, value in secrets.items():
            output = output.replace(value, f'[REDACTED:{name}]')
        return output
    
    sanitized = output
    
    # Layer 1: String matching
    for name, value in secrets.items():
        sanitized = sanitized.replace(value, f'[REDACTED:{name}]')
    
    # Layer 2: Normalization
    normalized_output = _normalize(sanitized)
    normalized_secrets = {k: _normalize(v) for k, v in secrets.items()}
    
    for name, value in normalized_secrets.items():
        if value in normalized_output:
            sanitized = f'[REDACTED:{name}]'
            _log_sanitization_event("normalization_detected", {
                "secret_name": name,
            })
            return sanitized
    
    # Layer 3: Encoding detection
    if SANITIZATION_CONFIG["detect_base64"]:
        sanitized = _decode_and_check_base64(sanitized, secrets)
    
    if SANITIZATION_CONFIG["detect_hex"]:
        sanitized = _decode_and_check_hex(sanitized, secrets)
    
    # Layer 4: Fragment detection
    if SANITIZATION_CONFIG["detect_fragments"]:
        sanitized = _check_fragments(sanitized, secrets)
    
    return sanitized


# =============================================================================
# PTY AND COMMAND EXECUTION
# =============================================================================

def run_with_pty(args, password, secrets=None):
    """
    Execute secretctl command with PTY and sanitize output.
    
    NEW: If placeholders detected in args, expand them first.
    """
    # Check for placeholders in args
    has_placeholders = any(PLACEHOLDER_PATTERN.search(arg) for arg in args)
    
    if has_placeholders:
        if not secrets:
            print("DENIED: placeholder expansion requires concrete secret keys")
            return 126
        args = expand_placeholders(args, secrets)
    
    cmd = ["secretctl", *args]
    env = os.environ.copy()
    master_fd, slave_fd = pty.openpty()
    attrs = termios.tcgetattr(slave_fd)
    attrs[3] = attrs[3] & ~termios.ECHO
    termios.tcsetattr(slave_fd, termios.TCSANOW, attrs)
    proc = subprocess.Popen(
        cmd,
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        env=env,
        close_fds=True,
        text=True,
    )
    os.close(slave_fd)
    prompt_tokens = ("master password", "password:")
    stdin_fd = sys.stdin.fileno()
    stdout_fd = sys.stdout.fileno()
    stdin_is_tty = os.isatty(stdin_fd)
    original_stdin_attrs = None
    if stdin_is_tty:
        original_stdin_attrs = termios.tcgetattr(stdin_fd)
        tty.setraw(stdin_fd)
    
    full_output = []
    
    try:
        while True:
            read_fds = [master_fd]
            if stdin_is_tty:
                read_fds.append(stdin_fd)
            ready, _, _ = select.select(read_fds, [], [], 0.1)
            if master_fd in ready:
                try:
                    data_bytes = os.read(master_fd, 1024)
                except OSError:
                    break
                if not data_bytes:
                    break
                data = data_bytes.decode("utf-8", errors="ignore")
                
                safe_data = data.replace(password, "[REDACTED:MASTER_PASSWORD]")
                
                full_output.append(safe_data)
                
                if secrets:
                    safe_data = _sanitize_output(safe_data, secrets)
                
                ok, error = _check_rate_limit(''.join(full_output))
                if not ok:
                    os.write(stdout_fd, error.encode("utf-8"))
                    proc.terminate()
                    return 126
                
                os.write(stdout_fd, safe_data.encode("utf-8", errors="ignore"))
                
                if any(token in data.lower() for token in prompt_tokens):
                    os.write(master_fd, (password + "\n").encode())
            if stdin_is_tty and stdin_fd in ready:
                try:
                    user_data = os.read(stdin_fd, 1024)
                except OSError:
                    user_data = b""
                if user_data:
                    os.write(master_fd, user_data)
            if proc.poll() is not None:
                break
    except KeyboardInterrupt:
        proc.terminate()
        proc.wait(timeout=2)
    finally:
        if stdin_is_tty and original_stdin_attrs is not None:
            termios.tcsetattr(stdin_fd, termios.TCSANOW, original_stdin_attrs)
    os.close(master_fd)
    return proc.returncode


# =============================================================================
# COMMAND VALIDATION (keep existing implementation)
# =============================================================================

def normalize_command(value):
    return value.strip().lower().replace("-", "_")


def parse_policy(policy_path):
    default_action = None
    allowed_commands = []
    in_allowed = False
    with open(policy_path, "r", encoding="utf-8") as fp:
        for raw_line in fp:
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("default_action:"):
                default_action = line.split(":", 1)[1].strip().strip("\"'")
                in_allowed = False
                continue
            if line.startswith("allowed_commands:"):
                in_allowed = True
                continue
            if in_allowed and line.startswith("- "):
                cmd = line[2:].strip().strip("\"'")
                if cmd:
                    allowed_commands.append(cmd)
                continue
            if in_allowed and not line.startswith("- "):
                in_allowed = False
    return default_action, allowed_commands


def is_global_wildcard(value):
    cleaned = value.strip().strip("\"'")
    return cleaned == "*"


def parse_run_request(args):
    has_no_sanitize = False
    key_patterns = []
    command = []
    idx = 0
    while idx < len(args):
        token = args[idx]
        if token == "--":
            command = args[idx + 1 :]
            break
        normalized = token.strip().lower().replace("_", "-")
        if normalized in BLOCKED_RUN_FLAGS:
            has_no_sanitize = True
        elif normalized.startswith("--no-sanitize="):
            has_no_sanitize = True
        elif token in {"-k", "--key"}:
            if idx + 1 >= len(args):
                return has_no_sanitize, key_patterns, command, "missing value for -k/--key"
            key_patterns.append(args[idx + 1])
            idx += 1
        elif token.startswith("--key="):
            key_patterns.append(token.split("=", 1)[1])
        idx += 1
    if not command:
        return has_no_sanitize, key_patterns, command, "missing command after --"
    if not key_patterns:
        return has_no_sanitize, key_patterns, command, "at least one -k/--key is required"
    for pattern in key_patterns:
        if is_global_wildcard(pattern):
            return has_no_sanitize, key_patterns, command, "global wildcard -k \"*\" is not allowed"
    return has_no_sanitize, key_patterns, command, None


def is_command_allowed_by_policy(command_argv):
    if not os.path.isfile(POLICY_PATH):
        return False, f"policy file not found: {POLICY_PATH}"
    try:
        default_action, allowed_commands = parse_policy(POLICY_PATH)
    except Exception as exc:
        return False, f"failed to parse policy: {exc}"
    if (default_action or "").lower() != "deny":
        return False, "policy must enforce default_action: deny"
    if not allowed_commands:
        return False, "policy has no allowed_commands"
    target = command_argv[0]
    resolved = shutil.which(target) if "/" not in target else target
    if not resolved:
        return False, f"command not found: {target}"
    resolved_path = str(Path(resolved).resolve())
    target_name = Path(target).name
    resolved_name = Path(resolved_path).name
    allowed = set()
    for entry in allowed_commands:
        allowed.add(entry)
        allowed.add(Path(entry).name)
        if entry.startswith("/"):
            allowed.add(str(Path(entry).resolve()))
    candidates = {target, target_name, resolved_path, resolved_name}
    if candidates.isdisjoint(allowed):
        return False, f"command '{target_name}' is not allowed by policy"
    return True, None


def validate_command(args):
    if not args:
        return 1
    command = normalize_command(args[0])
    if command in BLOCKED_COMMANDS:
        print(f"DENIED: command '{args[0]}' is not allowed in agent mode")
        return 126
    if command not in ALLOWED_COMMANDS:
        print(f"DENIED: command '{args[0]}' is not allowed; only 'run' is permitted")
        return 126
    has_no_sanitize, _, child_cmd, parse_error = parse_run_request(args[1:])
    if parse_error:
        print(f"DENIED: {parse_error}")
        return 126
    if has_no_sanitize:
        print("DENIED: --no-sanitize is not allowed in agent mode")
        return 126
    child_name = Path(child_cmd[0]).name.lower()
    if child_name in BLOCKED_CHILD_EXECUTORS:
        print(f"DENIED: executor '{child_name}' is not allowed")
        return 126
    allowed, reason = is_command_allowed_by_policy(child_cmd)
    if not allowed:
        print(f"DENIED: {reason}")
        return 126
    return 0


def load_runtime_secrets(key_patterns, password):
    secrets = {}
    for pattern in key_patterns:
        cleaned = pattern.strip().strip("\"'")
        if not cleaned or any(ch in cleaned for ch in {"*", "?", "[", "]"}):
            continue
        value = get_secret_value(cleaned, password)
        if not value:
            continue
        secrets[cleaned] = value
        alias = cleaned.replace("/", "_").upper()
        secrets[alias] = value
    return secrets


def validate_integrity():
    expected_hash = os.getenv("SECRETCTL_WRAPPER_SHA256", "").strip().lower()
    if not expected_hash:
        return 0
    with open(os.path.realpath(__file__), "rb") as fp:
        current_hash = hashlib.sha256(fp.read()).hexdigest().lower()
    if current_hash != expected_hash:
        print("DENIED: wrapper integrity check failed")
        return 126
    return 0


# =============================================================================
# MAIN
# =============================================================================

def main():
    if len(sys.argv) < 2:
        print("Usage: wrapper_secretctl.py <command> [args...]")
        return 1
    integrity_status = validate_integrity()
    if integrity_status != 0:
        return integrity_status
    command_status = validate_command(sys.argv[1:])
    if command_status != 0:
        return command_status
    password = os.getenv("SECRETCTL_PASSWORD")
    if not password:
        print("ERROR: set SECRETCTL_PASSWORD")
        return 1
    _, key_patterns, _, parse_error = parse_run_request(sys.argv[2:])
    if parse_error:
        print(f"DENIED: {parse_error}")
        return 126
    runtime_secrets = load_runtime_secrets(key_patterns, password)
    return run_with_pty(sys.argv[1:], password, secrets=runtime_secrets or None)


if __name__ == "__main__":
    raise SystemExit(main())
