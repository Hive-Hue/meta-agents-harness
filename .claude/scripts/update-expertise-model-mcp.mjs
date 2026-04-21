#!/usr/bin/env node
/**
 * update-expertise-model MCP server
 * 
 * Exposes update-expertise-model tool that appends notes to an agent's
 * expertise YAML file, matching the behavior of the pi runtime tool.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { resolve, join } from "path";
import pkg from "yaml";
const { parse: yamlParse, stringify: yamlStringify } = pkg;

// Constants matching multi-team.ts
const EXPERTISE_NOTE_MAX_CHARS = 2000;
const EXPERTISE_FILE_MAX_BYTES = 32_000;
const VALID_CATEGORIES = [
  "patterns", "risks", "tools", "workflows",
  "decisions", "lessons", "observations", "open_questions"
];

/**
 * Normalize category name to valid key, matching expertiseCategoryKey in multi-team.ts
 */
function normalizeCategory(category) {
  if (!category) return "observations";
  const normalized = category.toLowerCase().trim().replace(/[\s-]+/g, "_");
  const mapping = {
    "pattern": "patterns",
    "patterns": "patterns",
    "risk": "risks",
    "risks": "risks",
    "tool": "tools",
    "tools": "tools",
    "workflow": "workflows",
    "workflows": "workflows",
    "decision": "decisions",
    "decisions": "decisions",
    "lesson": "lessons",
    "lessons": "lessons",
    "observation": "observations",
    "observations": "observations",
    "open_question": "open_questions",
    "open_questions": "open_questions",
    "question": "open_questions",
    "questions": "open_questions",
  };
  return mapping[normalized] || "observations";
}

/**
 * Truncate note to max chars
 */
function shortText(text, maxChars) {
  if (!text) return "";
  const normalized = text.normalize("NFC");
  if (normalized.length <= maxChars) return normalized;
  return normalized.slice(0, maxChars - 3) + "...";
}

/**
 * Detect agent identity from working directory structure.
 * Looks for .pi/.active-crew.json to find crew, then environment or structure for agent.
 */
function detectAgentIdentity() {
  // Try .pi/.active-crew.json first
  const activeCrewPath = join(process.cwd(), ".pi", ".active-crew.json");
  let crew = null;
  
  if (existsSync(activeCrewPath)) {
    try {
      const crewData = JSON.parse(readFileSync(activeCrewPath, "utf-8"));
      crew = crewData.crew;
    } catch (e) {
      // Fall through to other detection methods
    }
  }
  
  // Also check for .marker/ structure (alternative convention)
  if (!crew) {
    const markerCrewPath = join(process.cwd(), ".marker", "crew");
    if (existsSync(markerCrewPath)) {
      try {
        const entries = readdirSync(markerCrewPath);
        if (entries.length > 0) {
          crew = entries[0];
        }
      } catch (e) {
        // Fall through
      }
    }
  }
  
  // Agent name from environment or session context
  let agent = process.env.AGENT_NAME || process.env.MAH_AGENT_NAME;
  
  // If still no agent, check for session-based marker
  if (!agent) {
    const sessionMarkerPath = join(process.cwd(), ".pi", "session-agent.txt");
    if (existsSync(sessionMarkerPath)) {
      try {
        agent = readFileSync(sessionMarkerPath, "utf-8").trim();
      } catch (e) {
        // Fall through
      }
    }
  }
  
  return { crew, agent };
}

/**
 * Find expertise file path for given agent and crew.
 */
function findExpertisePath(agent, crew) {
  if (!agent) return null;
  
  // Try .pi/crew/<crew>/expertise/<agent>-expertise-model.yaml
  if (crew) {
    const piPath = join(process.cwd(), ".pi", "crew", crew, "expertise", 
      `${agent}-expertise-model.yaml`);
    if (existsSync(piPath)) {
      return piPath;
    }
  }
  
  // Try without crew (default to "dev" if no crew found)
  const defaultCrew = crew || "dev";
  const defaultPath = join(process.cwd(), ".pi", "crew", defaultCrew, "expertise",
    `${agent}-expertise-model.yaml`);
  if (existsSync(defaultPath)) {
    return defaultPath;
  }
  
  // Try .marker/crew/<crew>/expertise/<agent>-expertise-model.yaml
  if (crew) {
    const markerPath = join(process.cwd(), ".marker", "crew", crew, "expertise",
      `${agent}-expertise-model.yaml`);
    if (existsSync(markerPath)) {
      return markerPath;
    }
  }
  
  return null;
}

/**
 * Load and parse expertise YAML file
 */
function loadExpertiseDoc(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const raw = readFileSync(filePath, "utf-8").trim();
    if (!raw) return null;

    const parsed = yamlParse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    for (const cat of VALID_CATEGORIES) {
      if (!Array.isArray(parsed[cat])) parsed[cat] = [];
    }

    return parsed;
  } catch (e) {
    return null;
  }
}

/**
 * Save expertise document back to YAML
 */
function saveExpertiseDoc(filePath, doc) {
  const safeDoc = { ...doc };

  for (const cat of VALID_CATEGORIES) {
    if (!Array.isArray(safeDoc[cat])) safeDoc[cat] = [];
  }

  let finalContent = yamlStringify(safeDoc, { lineWidth: 0 });

  while (
    Buffer.byteLength(finalContent, "utf-8") > EXPERTISE_FILE_MAX_BYTES &&
    VALID_CATEGORIES.some((c) => Array.isArray(safeDoc[c]) && safeDoc[c].length > 0)
  ) {
    for (const cat of VALID_CATEGORIES) {
      if (Array.isArray(safeDoc[cat]) && safeDoc[cat].length > 0) {
        safeDoc[cat].shift();
        break;
      }
    }

    finalContent = yamlStringify(safeDoc, { lineWidth: 0 });
  }

  writeFileSync(filePath, finalContent, "utf-8");
}

/**
 * Append note to expertise file
 */
function appendNote(note, category) {
  const { crew, agent } = detectAgentIdentity();
  
  if (!agent) {
    throw new Error("Could not detect agent identity. Set AGENT_NAME environment variable or ensure .pi/.active-crew.json exists.");
  }
  
  const filePath = findExpertisePath(agent, crew);
  
  if (!filePath) {
    throw new Error(`Expertise file not found for agent '${agent}' in crew '${crew || "dev"}'. Tried: .pi/crew/${crew || "dev"}/expertise/${agent}-expertise-model.yaml`);
  }
  
  // Load existing doc or create minimal structure
  let doc = loadExpertiseDoc(filePath);
  
  if (!doc) {
    // Create minimal doc if file doesn't exist or can't be parsed
    doc = {
      agent: { name: agent, role: "", team: crew || "unknown" },
      meta: { version: 1, max_lines: 120, last_updated: "" },
      patterns: [],
      risks: [],
      tools: [],
      workflows: [],
      decisions: [],
      lessons: [],
      observations: [],
      open_questions: []
    };
  }
  
  // Ensure meta exists
  if (!doc.meta) {
    doc.meta = { version: 1, max_lines: 120, last_updated: "" };
  }
  
  // Append the note
  const normalizedCategory = normalizeCategory(category);
  if (!Array.isArray(doc[normalizedCategory])) {
    doc[normalizedCategory] = [];
  }
  
  const normalizedNote = shortText(note, EXPERTISE_NOTE_MAX_CHARS);
  doc[normalizedCategory].push({
    date: new Date().toISOString().slice(0, 10),
    note: normalizedNote
  });
  
  // Update last_updated
  doc.meta.last_updated = new Date().toISOString();
  
  // Save
  saveExpertiseDoc(filePath, doc);
  
  return { agent, path: filePath, category: normalizedCategory };
}

// Create MCP server
const server = new Server(
  {
    name: "update-expertise-model",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  if (name !== "update-expertise-model") {
    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }
  
  try {
    const { note, category } = args;
    
    if (!note) {
      return {
        content: [{ type: "text", text: "Error: 'note' parameter is required" }],
        isError: true,
      };
    }
    
    const result = appendNote(note, category);
    
    return {
      content: [{
        type: "text",
        text: `Expertise model updated for ${result.agent}\n${result.path}`
      }],
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Register tool list handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "update-expertise-model",
        description: "Append a durable note to the current agent's expertise file.",
        inputSchema: {
          type: "object",
          properties: {
            note: {
              type: "string",
              description: "The durable insight, pattern, risk, or lesson learned.",
            },
            category: {
              type: "string",
              description: "Optional category such as pattern, risk, tool, lesson, or workflow. Defaults to 'observations'.",
            },
          },
          required: ["note"],
        },
      },
    ],
  };
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
