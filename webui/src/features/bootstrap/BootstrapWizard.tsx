import { useMemo, useState } from "react";
import { WizardStepper } from "./WizardStepper";
import { WizardInspector } from "./WizardInspector";
import { DetectWorkspace } from "./steps/DetectWorkspace";
import { SetupMode } from "./steps/SetupMode";
import { ProviderModel } from "./steps/ProviderModel";
import { ProjectDetails } from "./steps/ProjectDetails";
import { TopologyPreview } from "./steps/TopologyPreview";
import { ReviewWrite } from "./steps/ReviewWrite";
import { Icon } from "../../components/ui/Icon";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import "./bootstrap.css";

export type TopologyTeamConfig = {
  id: string;
  name: string;
  workerBase: string;
  workers: number;
  workerNames?: string[];
};

export type WizardData = {
  setupMode?: "logical" | "ai-assisted";
  provider?: string;
  apiKey?: string;
  model?: string;
  projectName?: string;
  crewId?: string;
  missionStatement?: string;
  description?: string;
  runtime?: string;
  topologyTeams?: string[];
  topologyWorkersPerTeam?: number;
  topologyTeamsConfig?: TopologyTeamConfig[];
  topologyIncludeLeads?: boolean;
  topologyAutoAi?: boolean;
  topologyReviewPrompt?: string;
  topologyAiMode?: "assisted" | "fallback";
  topologyAiError?: string;
  confirmed?: boolean;
};

const STEPS = [
  "Detect Workspace",
  "Setup Mode",
  "Provider & Model",
  "Project Details",
  "Topology Preview",
  "Review & Write",
];

export function BootstrapWizard() {
  const { refresh: refreshWorkspace } = useWorkspace();
  const [currentStep, setCurrentStep] = useState(1);
  const [wizardData, setWizardData] = useState<WizardData>({});
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [isWritingConfiguration, setIsWritingConfiguration] = useState(false);
  const [writeResult, setWriteResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleChange = (partial: Partial<WizardData>) => {
    setWizardData((prev) => ({ ...prev, ...partial }));
  };

  const fallbackAiTeams = useMemo<TopologyTeamConfig[]>(
    () => [
      { id: "planning", name: "Planning", workerBase: "planner", workers: 2, workerNames: ["planner-1", "planner-2"] },
      { id: "engineering", name: "Engineering", workerBase: "engineer", workers: 3, workerNames: ["engineer-1", "engineer-2", "engineer-3"] },
      { id: "validation", name: "Validation", workerBase: "validator", workers: 2, workerNames: ["validator-1", "validator-2"] },
    ],
    []
  );

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const isAiFallbackMode = (data: WizardData) =>
    data.setupMode === "ai-assisted" && !data.apiKey;

  const buildAiTopology = (baseData: WizardData, reviewPrompt = ""): TopologyTeamConfig[] => {
    const sourceTeams = baseData.topologyTeamsConfig && baseData.topologyTeamsConfig.length > 0
      ? baseData.topologyTeamsConfig
      : fallbackAiTeams;
    const text = `${baseData.projectName || ""} ${baseData.missionStatement || ""} ${reviewPrompt || ""}`.toLowerCase();

    let teams = sourceTeams.map((team) => ({ ...team, workerNames: [...(team.workerNames || [])] }));

    if (text.includes("security") && !teams.some((team) => team.id === "security")) {
      teams = [
        ...teams,
        {
          id: "security",
          name: "Security",
          workerBase: "security-reviewer",
          workers: 1,
          workerNames: ["security-reviewer-1"],
        },
      ];
    }

    return teams.map((team) => {
      const normalizedNames = Array.from({ length: team.workers }, (_, index) => {
        const explicit = team.workerNames?.[index]?.trim();
        if (explicit) return explicit;
        return `${team.workerBase}-${index + 1}`;
      });
      return {
        ...team,
        workerNames: normalizedNames,
      };
    });
  };

  const runAiTopologyRound = async (reviewPrompt = "") => {
    setIsAiGenerating(true);
    const fallback = isAiFallbackMode(wizardData);
    const waitMs = fallback ? 2800 + Math.floor(Math.random() * 1200) : 1200;
    await sleep(waitMs);

    if (!fallback) {
      try {
        const response = await fetch("/api/mah/bootstrap/topology", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            setupMode: wizardData.setupMode,
            provider: wizardData.provider,
            model: wizardData.model,
            apiKey: wizardData.apiKey,
            projectName: wizardData.projectName,
            crewId: wizardData.crewId,
            missionStatement: wizardData.missionStatement,
            description: wizardData.description,
            reviewPrompt,
          }),
        });
        const payload = await response.json();
        if (response.ok && payload?.ok && payload?.topology?.teams) {
          handleChange({
            topologyTeamsConfig: payload.topology.teams,
            topologyIncludeLeads: !!payload.topology.includeLeads,
            topologyReviewPrompt: reviewPrompt,
            topologyAiMode: "assisted",
            topologyAiError: "",
          });
          setIsAiGenerating(false);
          return;
        }
        const errorDetails = [
          payload?.error ? `error: ${payload.error}` : "",
          payload?.stderr ? `stderr: ${String(payload.stderr).slice(0, 280)}` : "",
          payload?.stdout ? `stdout: ${String(payload.stdout).slice(0, 180)}` : "",
          !response.ok ? `http_status: ${response.status}` : "",
        ].filter(Boolean).join(" | ");
        handleChange({
          topologyAiError: errorDetails || "unknown ai generation failure",
        });
      } catch {
        handleChange({
          topologyAiError: "network error while requesting AI topology generation",
        });
        // fall through to deterministic fallback
      }
    }

    handleChange({
      topologyTeamsConfig: buildAiTopology(wizardData, reviewPrompt),
      topologyReviewPrompt: reviewPrompt,
      topologyAiMode: "fallback",
    });
    setIsAiGenerating(false);
  };

  const handleNext = async () => {
    if (currentStep === 5 && wizardData.setupMode === "ai-assisted" && (wizardData.topologyAutoAi ?? true)) {
      await runAiTopologyRound(wizardData.topologyReviewPrompt || "");
      setCurrentStep(6);
      return;
    }
    setCurrentStep((s) => Math.min(6, s + 1));
  };

  const handleRequestAiRound = async () => {
    const prompt = wizardData.topologyReviewPrompt || "";
    await runAiTopologyRound(prompt);
  };

  const handleWriteConfiguration = async (yamlContent: string) => {
    setIsWritingConfiguration(true);
    setWriteResult(null);
    try {
      const response = await fetch("/api/mah/bootstrap/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: yamlContent }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || `http ${response.status}`);
      }
      await refreshWorkspace();
      window.dispatchEvent(new CustomEvent("mah:workspace-updated"));
      setWriteResult({ ok: true, message: "meta-agents.yaml written successfully." });
    } catch (error) {
      setWriteResult({
        ok: false,
        message: `Failed to write configuration: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      setIsWritingConfiguration(false);
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return <DetectWorkspace />;
      case 2:
        return <SetupMode data={wizardData} onChange={handleChange} />;
      case 3:
        return <ProviderModel data={wizardData} onChange={handleChange} />;
      case 4:
        return <ProjectDetails data={wizardData} onChange={handleChange} />;
      case 5:
        return (
          <TopologyPreview
            data={wizardData}
            onChange={handleChange}
            isAiGenerating={isAiGenerating}
            isAiFallback={isAiFallbackMode(wizardData)}
          />
        );
      case 6:
        return (
          <ReviewWrite
            data={wizardData}
            onChange={handleChange}
            onRequestAiRound={handleRequestAiRound}
            isAiGenerating={isAiGenerating}
            onWriteConfiguration={handleWriteConfiguration}
            isWritingConfiguration={isWritingConfiguration}
            writeResult={writeResult}
          />
        );
      default:
        return null;
    }
  };

  return (
    <>
      <main className="wizard-main">
        <section className="screen-header">
          <div>
            <h2>Bootstrap Wizard</h2>
            <p className="wizard-subtitle">
              Configure and generate your MAH project configuration
            </p>
          </div>
        </section>
        <WizardStepper steps={STEPS} currentStep={currentStep} />
        <section className="wizard-main__content">{renderStep()}</section>
        <footer className="wizard-nav">
          <button
            className="wizard-nav__btn wizard-nav__btn--back"
            type="button"
            disabled={currentStep === 1}
            onClick={() => setCurrentStep((s) => s - 1)}
          >
            <Icon name="arrow_back" size={16} />
            Back
          </button>
          <button
            className="wizard-nav__btn wizard-nav__btn--next"
            type="button"
            disabled={currentStep === 6 || isAiGenerating}
            onClick={handleNext}
          >
            {isAiGenerating ? "Working..." : currentStep === 6 ? "Finish" : "Next"}
            <Icon name={isAiGenerating ? "autorenew" : "arrow_forward"} size={16} className={isAiGenerating ? "wizard-spin" : ""} />
          </button>
        </footer>
      </main>
      <aside className="inspector wizard-inspector" aria-label="Bootstrap inspector">
        <WizardInspector step={currentStep} data={wizardData} />
      </aside>
    </>
  );
}
