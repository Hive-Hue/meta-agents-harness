#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import { updateMentalModel } from "./lib/mental-model.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const runtimeRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(runtimeRoot, "..");
const serverVersion = "0.1.0";
const toolName = "update_mental_model";

let inputBuffer = Buffer.alloc(0);

function sendMessage(message) {
  const payload = Buffer.from(JSON.stringify(message), "utf-8");
  process.stdout.write(`Content-Length: ${payload.byteLength}\r\n\r\n`);
  process.stdout.write(payload);
}

function sendResponse(id, result) {
  sendMessage({
    jsonrpc: "2.0",
    id,
    result,
  });
}

function sendError(id, code, message, data) {
  sendMessage({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
  });
}

function toolDefinition() {
  return {
    name: toolName,
    description: "Append a durable note to an agent mental-model YAML file resolved from the active Claude multi-team config.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        agent: {
          type: "string",
          description: "Agent id from multi-team.yaml. Always pass your own agent id unless using expertise_path explicitly.",
        },
        note: {
          type: "string",
          description: "Durable lesson, risk, decision, pattern, or workflow note to persist.",
        },
        category: {
          type: "string",
          description: "Optional category such as lessons, risks, decisions, tools, patterns, workflows, or open_questions.",
        },
        expertise_path: {
          type: "string",
          description: "Optional explicit expertise file path. Restricted to .claude expertise directories.",
        },
        role: {
          type: "string",
          description: "Optional fallback role used only when creating a new file outside known crew config.",
        },
        team: {
          type: "string",
          description: "Optional fallback team used only when creating a new file outside known crew config.",
        },
        max_lines: {
          type: "number",
          description: "Optional fallback line cap used only when no expertise file or config value exists.",
        },
      },
      required: ["note"],
    },
  };
}

function textResult(text, isError = false, structuredContent = undefined) {
  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
    ...(isError ? { isError: true } : {}),
    ...(structuredContent === undefined ? {} : { structuredContent }),
  };
}

function handleInitialize(message) {
  sendResponse(message.id, {
    protocolVersion: "2024-11-05",
    capabilities: {
      tools: {},
    },
    serverInfo: {
      name: "mental-model",
      version: serverVersion,
    },
  });
}

function handleToolsList(message) {
  sendResponse(message.id, {
    tools: [toolDefinition()],
  });
}

function handleToolCall(message) {
  const name = message?.params?.name;
  if (name !== toolName) {
    sendResponse(message.id, textResult(`Unknown tool: ${name || "(missing name)"}`, true));
    return;
  }

  try {
    const result = updateMentalModel(message?.params?.arguments || {}, { repoRoot, runtimeRoot });
    sendResponse(message.id, textResult(JSON.stringify(result, null, 2), false, result));
  } catch (error) {
    sendResponse(
      message.id,
      textResult(
        JSON.stringify(
          {
            status: "error",
            message: error.message,
          },
          null,
          2,
        ),
        true,
        {
          status: "error",
          message: error.message,
        },
      ),
    );
  }
}

function handleRequest(message) {
  switch (message.method) {
    case "initialize":
      handleInitialize(message);
      return;
    case "tools/list":
      handleToolsList(message);
      return;
    case "tools/call":
      handleToolCall(message);
      return;
    case "ping":
      sendResponse(message.id, {});
      return;
    case "notifications/initialized":
      return;
    default:
      sendError(message.id ?? null, -32601, `Method not found: ${message.method}`);
  }
}

function parseMessages() {
  while (true) {
    const headerEnd = inputBuffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;

    const headerText = inputBuffer.slice(0, headerEnd).toString("utf-8");
    const contentLengthHeader = headerText
      .split("\r\n")
      .map((line) => line.trim())
      .find((line) => line.toLowerCase().startsWith("content-length:"));

    if (!contentLengthHeader) {
      sendError(null, -32700, "Missing Content-Length header");
      inputBuffer = Buffer.alloc(0);
      return;
    }

    const contentLength = Number(contentLengthHeader.split(":")[1]?.trim() || NaN);
    if (!Number.isFinite(contentLength) || contentLength < 0) {
      sendError(null, -32700, "Invalid Content-Length header");
      inputBuffer = Buffer.alloc(0);
      return;
    }

    const frameLength = headerEnd + 4 + contentLength;
    if (inputBuffer.length < frameLength) return;

    const payload = inputBuffer.slice(headerEnd + 4, frameLength).toString("utf-8");
    inputBuffer = inputBuffer.slice(frameLength);

    try {
      const message = JSON.parse(payload);
      handleRequest(message);
    } catch (error) {
      sendError(null, -32700, `Invalid JSON payload: ${error.message}`);
    }
  }
}

process.stdin.on("data", (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  parseMessages();
});

process.stdin.on("error", (error) => {
  sendError(null, -32000, `stdin error: ${error.message}`);
});

