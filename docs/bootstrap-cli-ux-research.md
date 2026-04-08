# Bootstrap CLI Onboarding — UX Research Questions

## Research Goals

Understand operator expectations, friction points, and mental models for the bootstrap CLI onboarding flow.

---

## Questions

1. **Onboarding Entry Point**
   When you first run `meta-agents bootstrap`, what do you expect to happen? What would make you feel confident vs. confused in the first 30 seconds?

2. **Required vs. Optional Field Tolerance**
   The bootstrap flow requires a project name and team identifier, with optional AI provider credentials. When prompted for optional fields, do you prefer to skip immediately, see explanations first, or get smart defaults that you can override?

3. **AI-Assisted Mode Trust**
   If the bootstrap CLI offered an AI-assisted mode (requiring an API key or OAuth), what would make you trust it enough to opt in vs.拒绝了 it entirely? Specifically: would seeing "your key stays local" reduce hesitation?

4. **Error Recovery and Undo**
   If you misconfigured something during bootstrap (e.g., wrong team ID), how would you prefer to recover? Would you rather re-run the command, edit a generated file directly, or restart the questionnaire from a checkpoint?

5. **Non-Interactive Expectations**
   In CI/CD or scripted environments, operators expect `--yes` to "just work." What minimum set of flags would make you confident that bootstrap will succeed without prompting, and what values would you want as defaults vs. what must be explicit?

---

## Response Mapping

| Question | Insight Category | Related Spec Artifact |
|---|---|---|
| Q1 | Mental model, first-run confidence | `specs/bootstrap-cli-spec.yaml` |
| Q2 | Decision fatigue, optional field handling | `specs/bootstrap-cli-spec.yaml` |
| Q3 | Trust heuristics, AI opt-in barriers | `specs/ai-assist-boot-spec.md` |
| Q4 | Recovery UX, error messaging | `specs/bootstrap-cli-spec.yaml` |
| Q5 | Non-interactive parity, flag contracts | `specs/bootstrap-cli-spec.yaml` |

---

*Maintained by: UX Researcher (Product Team)*
*Session: 2026-04-07T15-45-42-427Z-m5x17n*
