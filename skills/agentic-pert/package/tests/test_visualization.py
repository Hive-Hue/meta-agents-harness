"""Tests for visualization module."""

import pytest
import json
from agentic_pert import Task, Plan, Visualizer
from agentic_pert.visualization import to_mermaid, to_d3, to_react_flow, to_dot, to_ascii


@pytest.fixture
def sample_plan():
    """Create a sample plan for testing."""
    tasks = [
        Task(
            id="T1",
            description="Setup JWT library",
            predecessors=[],
            pert_duration=1.5,
            optimistic=1.0,
            most_likely=1.5,
            pessimistic=2.5,
            status="pending",
        ),
        Task(
            id="T2",
            description="Auth endpoints",
            predecessors=["T1"],
            pert_duration=3.0,
            optimistic=2.0,
            most_likely=3.0,
            pessimistic=5.0,
            status="pending",
        ),
        Task(
            id="T3",
            description="Dashboard base",
            predecessors=["T1"],
            pert_duration=2.0,
            optimistic=1.5,
            most_likely=2.0,
            pessimistic=3.0,
            status="pending",
        ),
        Task(
            id="T4",
            description="Auth integration",
            predecessors=["T2", "T3"],
            pert_duration=1.5,
            optimistic=1.0,
            most_likely=1.5,
            pessimistic=2.5,
            status="pending",
        ),
        Task(
            id="T5",
            description="Tests",
            predecessors=["T4"],
            pert_duration=2.5,
            optimistic=2.0,
            most_likely=2.5,
            pessimistic=4.0,
            status="pending",
        ),
    ]
    
    return Plan(
        tasks=tasks,
        critical_path=["T1", "T2", "T4", "T5"],
        total_duration=8.5,
        parallelism_groups=[
            {"batch": 1, "tasks": ["T1"], "can_run_parallel": False},
            {"batch": 2, "tasks": ["T2", "T3"], "can_run_parallel": True},
            {"batch": 3, "tasks": ["T4"], "can_run_parallel": False},
            {"batch": 4, "tasks": ["T5"], "can_run_parallel": False},
        ],
    )


class TestMermaidFormat:
    """Test Mermaid flowchart generation."""
    
    def test_mermaid_contains_flowchart(self, sample_plan):
        """Should contain flowchart TD header."""
        result = to_mermaid(sample_plan)
        assert "flowchart TD" in result
    
    def test_mermaid_contains_all_tasks(self, sample_plan):
        """Should contain all task IDs."""
        result = to_mermaid(sample_plan)
        for task in sample_plan.tasks:
            assert task.id in result
    
    def test_mermaid_contains_class_definitions(self, sample_plan):
        """Should contain class definitions for styling."""
        result = to_mermaid(sample_plan)
        assert "classDef critical" in result
        assert "classDef normal" in result
    
    def test_mermaid_critical_path_highlighted(self, sample_plan):
        """Critical tasks should use critical class."""
        result = to_mermaid(sample_plan)
        # T1 is critical
        assert "T1[" in result
        assert "critical" in result
    
    def test_mermaid_dependencies(self, sample_plan):
        """Should show dependencies as arrows."""
        result = to_mermaid(sample_plan)
        # T2 depends on T1
        assert "T1" in result and "T2" in result

    def test_mermaid_classic_pert_has_event_nodes(self, sample_plan):
        """Classic PERT should use event nodes and activity arrows."""
        result = to_mermaid(sample_plan, style="classic-pert")
        assert "flowchart LR" in result
        assert "Início" in result
        assert "Fim" in result
        assert "dummy" in result
        assert "T1 · 1.5h" in result

    def test_mermaid_pert_gantt_has_gantt_header(self, sample_plan):
        """PERT gantt should emit Mermaid gantt syntax."""
        result = to_mermaid(sample_plan, style="pert-gantt")
        assert "gantt" in result
        assert "dateFormat YYYY-MM-DD HH:mm" in result
        assert "section Batch 1" in result
        assert "crit, T1" in result or "crit, T2" in result

    def test_mermaid_pert_gantt_allows_custom_milestone_label(self, sample_plan):
        """PERT gantt should support a custom final milestone label."""
        result = to_mermaid(
            sample_plan,
            style="pert-gantt",
            milestone_label="Resumo operacional pronto",
        )
        assert "Resumo operacional pronto :milestone" in result


class TestD3Format:
    """Test D3.js node-link format."""
    
    def test_d3_has_nodes(self, sample_plan):
        """Should have nodes array."""
        result = to_d3(sample_plan)
        assert "nodes" in result
        assert len(result["nodes"]) == 5
    
    def test_d3_has_links(self, sample_plan):
        """Should have links array."""
        result = to_d3(sample_plan)
        assert "links" in result
        assert len(result["links"]) == 5  # T1->T2, T1->T3, T2->T4, T3->T4, T4->T5
    
    def test_d3_node_properties(self, sample_plan):
        """Nodes should have required properties."""
        result = to_d3(sample_plan)
        node = result["nodes"][0]
        assert "id" in node
        assert "label" in node
        assert "duration" in node
        assert "critical" in node
        assert "status" in node
    
    def test_d3_metadata(self, sample_plan):
        """Should have metadata with critical path."""
        result = to_d3(sample_plan)
        assert "metadata" in result
        assert "criticalPath" in result["metadata"]
        assert result["metadata"]["criticalPath"] == ["T1", "T2", "T4", "T5"]
    
    def test_d3_serializable(self, sample_plan):
        """Should be JSON serializable."""
        result = to_d3(sample_plan)
        json_str = json.dumps(result)
        assert json_str is not None


class TestReactFlowFormat:
    """Test React Flow format."""
    
    def test_react_flow_has_nodes(self, sample_plan):
        """Should have nodes array."""
        result = to_react_flow(sample_plan)
        assert "nodes" in result
        assert len(result["nodes"]) == 5
    
    def test_react_flow_has_edges(self, sample_plan):
        """Should have edges array."""
        result = to_react_flow(sample_plan)
        assert "edges" in result
    
    def test_react_flow_node_structure(self, sample_plan):
        """Nodes should have React Flow structure."""
        result = to_react_flow(sample_plan)
        node = result["nodes"][0]
        assert "id" in node
        assert "type" in node
        assert "data" in node
        assert "position" in node
        assert "x" in node["position"]
        assert "y" in node["position"]
    
    def test_react_flow_critical_edges_animated(self, sample_plan):
        """Critical path edges should be animated."""
        result = to_react_flow(sample_plan)
        # T1 -> T2 is critical
        t1_t2_edge = next(
            (e for e in result["edges"] if e["source"] == "T1" and e["target"] == "T2"),
            None
        )
        assert t1_t2_edge is not None
        assert t1_t2_edge.get("animated") is True
    
    def test_react_flow_has_viewport(self, sample_plan):
        """Should have viewport configuration."""
        result = to_react_flow(sample_plan)
        assert "viewport" in result


class TestDotFormat:
    """Test Graphviz DOT format."""
    
    def test_dot_is_digraph(self, sample_plan):
        """Should be a digraph."""
        result = to_dot(sample_plan)
        assert "digraph G {" in result
        assert "}" in result
    
    def test_dot_has_rankdir(self, sample_plan):
        """Should have rankdir TB."""
        result = to_dot(sample_plan)
        assert "rankdir=TB" in result
    
    def test_dot_contains_all_tasks(self, sample_plan):
        """Should contain all task IDs."""
        result = to_dot(sample_plan)
        for task in sample_plan.tasks:
            assert task.id in result
    
    def test_dot_critical_color(self, sample_plan):
        """Critical tasks should be red."""
        result = to_dot(sample_plan)
        assert "#ff6b6b" in result  # Critical color
    
    def test_dot_edges(self, sample_plan):
        """Should have edges."""
        result = to_dot(sample_plan)
        assert "->" in result


class TestASCIIFormat:
    """Test ASCII art format."""
    
    def test_ascii_contains_tasks(self, sample_plan):
        """Should contain task IDs."""
        result = to_ascii(sample_plan)
        for task in sample_plan.tasks:
            assert task.id in result
    
    def test_ascii_shows_critical(self, sample_plan):
        """Should show critical marker."""
        result = to_ascii(sample_plan)
        assert "CRITICAL" in result or "⚠️" in result
    
    def test_ascii_has_boxes(self, sample_plan):
        """Should use box drawing characters."""
        result = to_ascii(sample_plan)
        assert "┌" in result or "└" in result
    
    def test_ascii_shows_duration(self, sample_plan):
        """Should show task duration."""
        result = to_ascii(sample_plan)
        assert "h" in result  # Hours indicator


class TestVisualizerClass:
    """Test Visualizer class directly."""
    
    def test_visualizer_init(self, sample_plan):
        """Should initialize with plan."""
        viz = Visualizer(sample_plan)
        assert viz.plan == sample_plan
        assert len(viz._task_map) == 5
    
    def test_calculate_levels(self, sample_plan):
        """Should calculate topological levels."""
        viz = Visualizer(sample_plan)
        levels = viz._calculate_levels()
        
        # T1 has no predecessors -> level 0
        assert levels["T1"] == 0
        
        # T2 and T3 depend on T1 -> level 1
        assert levels["T2"] == 1
        assert levels["T3"] == 1
        
        # T4 depends on T2 and T3 -> level 2
        assert levels["T4"] == 2
        
        # T5 depends on T4 -> level 3
        assert levels["T5"] == 3
    
    def test_status_color(self, sample_plan):
        """Should return correct status colors."""
        viz = Visualizer(sample_plan)
        
        assert viz._status_color("pending") == "#f8f9fa"
        assert viz._status_color("running") == "#74c0fc"
        assert viz._status_color("completed") == "#51cf66"
        assert viz._status_color("failed") == "#ff6b6b"
    
    def test_status_icon(self, sample_plan):
        """Should return correct status icons."""
        viz = Visualizer(sample_plan)
        
        assert viz._status_icon("pending") == "⏳"
        assert viz._status_icon("running") == "🔄"
        assert viz._status_icon("completed") == "✅"
        assert viz._status_icon("failed") == "❌"


class TestJSONExport:
    """Test JSON export functionality."""
    
    def test_to_json_default(self, sample_plan):
        """Should export to JSON with default format."""
        viz = Visualizer(sample_plan)
        result = viz.to_json()
        
        # Should be valid JSON
        data = json.loads(result)
        assert "tasks" in data
        assert "critical_path" in data
    
    def test_to_json_d3_format(self, sample_plan):
        """Should export to JSON with D3 format."""
        viz = Visualizer(sample_plan)
        result = viz.to_json(format="d3")
        
        data = json.loads(result)
        assert "nodes" in data
        assert "links" in data
    
    def test_to_json_react_flow_format(self, sample_plan):
        """Should export to JSON with React Flow format."""
        viz = Visualizer(sample_plan)
        result = viz.to_json(format="react-flow")
        
        data = json.loads(result)
        assert "nodes" in data
        assert "edges" in data
