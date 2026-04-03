---
name: web-research
description: Run evidence-based web research with Brave Search for discovery and Firecrawl for extraction/synthesis.
---

# Web Research

Use this skill when a task depends on up-to-date external information (platform selection, market scans, benchmarks, references, trend checks).

## Tool Strategy

1. Discovery with Brave Search
- start broad, then narrow with precise queries
- collect multiple candidate sources before concluding
- prefer recent and primary sources when possible

2. Extraction with Firecrawl
- use scrape/extract for target pages selected from discovery
- capture only relevant facts for the decision at hand
- keep raw evidence traceable by URL

3. Synthesis
- compare sources, identify conflicts, and state assumptions
- avoid single-source conclusions for strategic decisions
- summarize recommendations with rationale and confidence level

## Quality Rules

- always include source URLs in outputs
- include publication/update date when available
- separate observed facts from inferences
- flag stale or low-credibility sources

## Output Contract

1. objective and scope used for research
2. shortlist of sources scanned
3. key findings with evidence
4. recommendation with tradeoffs and risks
