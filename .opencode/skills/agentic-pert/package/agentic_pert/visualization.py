"""
Visualization module for Agentic PERT + CPM.

Generates multiple output formats for UI integration:
- Mermaid flowchart (docs/GitHub)
- D3.js node-link (web apps)
- Cytoscape.js (graph analysis)
- React Flow (interactive diagrams)
- Graphviz DOT (universal)
- ASCII art (terminal)
"""

from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Literal, Optional
import json

# Import from models to avoid duplication
from .models import Task, Plan


@dataclass
class TaskTimings:
    """Timing information for a task."""
    early_start: float = 0.0
    early_finish: float = 0.0
    late_start: float = 0.0
    late_finish: float = 0.0
    float_: float = 0.0


class Visualizer:
    """Generate multiple visualization formats from a Plan."""
    
    def __init__(self, plan: Plan, timings: Optional[dict[str, TaskTimings]] = None):
        self.plan = plan
        self._task_map = {t.id: t for t in plan.tasks}
        self._critical_set = set(plan.critical_path)
        self._timings = timings or {}
    
    def _is_critical(self, task_id: str) -> bool:
        """Check if task is on critical path."""
        return task_id in self._critical_set
    
    def _get_task_timings(self, task_id: str) -> TaskTimings:
        """Get timing information for a task."""
        if task_id in self._timings:
            t = self._timings[task_id]
            if isinstance(t, TaskTimings):
                return t
            # Handle dict format
            return TaskTimings(
                early_start=t.get("ES", 0.0),
                early_finish=t.get("EF", 0.0),
                late_start=t.get("LS", 0.0),
                late_finish=t.get("LF", 0.0),
                float_=t.get("float", 0.0),
            )
        return TaskTimings()
    
    def to_mermaid(
        self,
        style: Literal["flowchart", "classic-pert", "pert-gantt"] = "flowchart",
        milestone_label: Optional[str] = None,
    ) -> str:
        """Generate Mermaid output in one of the supported styles."""
        if style == "flowchart":
            return self._to_mermaid_flowchart()
        if style == "classic-pert":
            return self._to_mermaid_classic_pert()
        if style == "pert-gantt":
            return self._to_mermaid_pert_gantt(milestone_label=milestone_label)
        raise ValueError(f"Unknown mermaid style: {style}")

    def _to_mermaid_flowchart(self) -> str:
        """
        Generate Mermaid flowchart diagram.
        
        Critical path nodes are highlighted in red.
        Dependencies shown as solid arrows.
        """
        lines = ["flowchart TD"]
        
        # Node definitions with classes
        for task in self.plan.tasks:
            is_critical = self._is_critical(task.id)
            node_class = "critical" if is_critical else "normal"
            label = f"{task.id}[{task.description}\\n{task.pert_duration:.1f}h]"
            lines.append(f"  {label}:::{node_class}")
        
        lines.append("")
        
        # Edges - solid for critical path, dashed for others
        for task in self.plan.tasks:
            for pred in task.predecessors:
                is_critical_edge = self._is_critical(pred) and self._is_critical(task.id)
                style = "-->" if is_critical_edge else " -.-> "
                lines.append(f"  {pred}{style}{task.id}")
        
        # Class definitions
        lines.append("")
        lines.append("  classDef critical fill:#ff6b6b,stroke:#c92a2a,stroke-width:2px,color:#fff")
        lines.append("  classDef normal fill:#74c0fc,stroke:#339af0,stroke-width:1px,color:#000")
        
        return "\n".join(lines)

    def _to_mermaid_classic_pert(self) -> str:
        """
        Generate a classic PERT activity-on-arrow style diagram.

        Events are represented as nodes and activities as labeled arrows.
        Multi-predecessor joins are modeled with dummy zero-duration arrows.
        """
        lines = ["flowchart LR"]
        event_counter = 0

        def new_event(label: str, event_time: float, css_class: str = "event") -> str:
            nonlocal event_counter
            node_id = f"E{event_counter}"
            event_counter += 1
            safe_label = label.replace('"', "'")
            lines.append(f'  {node_id}(("{safe_label}\\n{event_time:.1f}h")):::{css_class}')
            return node_id

        start_event = new_event("Início", 0.0, "start")
        task_end_events: dict[str, str] = {}
        task_start_events: dict[str, str] = {}

        for task in self.plan.tasks:
            timings = self._get_task_timings(task.id)

            if not task.predecessors:
                start_node = start_event
            elif len(task.predecessors) == 1:
                start_node = task_end_events[task.predecessors[0]]
            else:
                start_node = new_event(f"Join {task.id}", timings.early_start, "join")
                for predecessor in task.predecessors:
                    pred_end = task_end_events[predecessor]
                    lines.append(f"  {pred_end} -. dummy · 0h .-> {start_node}")

            end_node = new_event(f"Evento {task.id}", timings.early_finish, "event")
            task_start_events[task.id] = start_node
            task_end_events[task.id] = end_node

            edge = "-->" if self._is_critical(task.id) else "-.->"
            lines.append(
                f"  {start_node} {edge}|{task.id} · {task.pert_duration:.1f}h| {end_node}"
            )

        terminal_tasks = [task for task in self.plan.tasks if not self._dependents_of(task.id)]
        if not terminal_tasks:
            terminal_tasks = self.plan.tasks

        if len(terminal_tasks) == 1:
            final_join = task_end_events[terminal_tasks[0].id]
        else:
            final_join_time = max(self._get_task_timings(task.id).early_finish for task in terminal_tasks)
            final_join = new_event("Convergência final", final_join_time, "join")
            for task in terminal_tasks:
                lines.append(f"  {task_end_events[task.id]} -. dummy · 0h .-> {final_join}")

        final_event = new_event("Fim", self.plan.total_duration, "finish")
        lines.append(f"  {final_join} -. dummy · 0h .-> {final_event}")
        lines.append("")
        lines.append("  classDef start fill:#d3f9d8,stroke:#2b8a3e,color:#111;")
        lines.append("  classDef join fill:#fff3bf,stroke:#e67700,color:#111;")
        lines.append("  classDef event fill:#e7f5ff,stroke:#1c7ed6,color:#111;")
        lines.append("  classDef finish fill:#ffd8d8,stroke:#c92a2a,color:#111;")
        return "\n".join(lines)

    def _to_mermaid_pert_gantt(self, milestone_label: Optional[str] = None) -> str:
        """
        Generate a Mermaid Gantt chart using synthetic dates and PERT timings.
        """
        base = datetime(2026, 1, 1, 0, 0)
        lines = [
            "gantt",
            "  title PERT/CPM Schedule",
            "  dateFormat YYYY-MM-DD HH:mm",
            "  axisFormat %H:%M",
        ]

        groups = self.plan.parallelism_groups or [{"batch": 1, "tasks": [t.id for t in self.plan.tasks]}]
        task_map = {task.id: task for task in self.plan.tasks}

        for group in groups:
            lines.append(f"  section Batch {group['batch']}")
            for task_id in group["tasks"]:
                task = task_map[task_id]
                timings = self._get_task_timings(task.id)
                tags = ["crit"] if self._is_critical(task.id) else []
                metadata = []
                if tags:
                    metadata.extend(tags)
                metadata.append(task.id)
                if task.predecessors:
                    metadata.append("after " + " ".join(task.predecessors))
                else:
                    metadata.append((base + timedelta(hours=timings.early_start)).strftime("%Y-%m-%d %H:%M"))
                metadata.append(self._duration_to_mermaid_minutes(task.pert_duration))
                lines.append(f"  {self._sanitize_mermaid_gantt_label(task.description)} :{', '.join(metadata)}")

        lines.append(
            f"  {self._sanitize_mermaid_gantt_label(milestone_label or 'Fim do plano')} :milestone, plan_finish, "
            f"{(base + timedelta(hours=self.plan.total_duration)).strftime('%Y-%m-%d %H:%M')}, 0m"
        )
        return "\n".join(lines)
    
    def to_d3_format(self) -> dict:
        """
        Generate D3.js node-link format.
        
        Compatible with d3-force and similar layouts.
        """
        nodes = []
        for task in self.plan.tasks:
            timings = self._get_task_timings(task.id)
            nodes.append({
                "id": task.id,
                "label": task.description,
                "duration": task.pert_duration,
                "critical": self._is_critical(task.id),
                "status": task.status,
                "earlyStart": timings.early_start,
                "earlyFinish": timings.early_finish,
                "lateStart": timings.late_start,
                "lateFinish": timings.late_finish,
                "float": timings.float_,
            })
        
        links = []
        for task in self.plan.tasks:
            for pred in task.predecessors:
                links.append({
                    "source": pred,
                    "target": task.id,
                    "type": "dependency",
                    "critical": self._is_critical(pred) and self._is_critical(task.id),
                })
        
        return {
            "nodes": nodes,
            "links": links,
            "metadata": {
                "totalDuration": self.plan.total_duration,
                "criticalPath": self.plan.critical_path,
                "parallelismGroups": self.plan.parallelism_groups,
            }
        }
    
    def to_cytoscape_format(self) -> dict:
        """
        Generate Cytoscape.js format.
        
        Includes style and layout configuration.
        """
        nodes = []
        for task in self.plan.tasks:
            is_critical = self._is_critical(task.id)
            bg_color = "#ff6b6b" if is_critical else "#74c0fc"
            nodes.append({
                "data": {
                    "id": task.id,
                    "label": task.description,
                    "pert": task.pert_duration,
                    "critical": is_critical,
                    "status": task.status,
                },
                "style": {
                    "background-color": bg_color,
                    "label": f"{task.id}",
                }
            })
        
        edges = []
        edge_id = 0
        for task in self.plan.tasks:
            for pred in task.predecessors:
                is_critical = self._is_critical(pred) and self._is_critical(task.id)
                edges.append({
                    "data": {
                        "id": f"e{edge_id}",
                        "source": pred,
                        "target": task.id,
                    },
                    "style": {
                        "line-color": "#ff6b6b" if is_critical else "#adb5bd",
                        "width": 3 if is_critical else 1,
                    }
                })
                edge_id += 1
        
        return {
            "elements": {
                "nodes": nodes,
                "edges": edges,
            },
            "layout": {
                "name": "dagre",
                "rankDir": "TB",
                "nodeSep": 50,
                "rankSep": 100,
            },
            "style": [
                {"selector": "node", "style": {"label": "data(label)", "text-valign": "center"}},
                {"selector": "edge", "style": {"curve-style": "bezier", "target-arrow-shape": "triangle"}},
            ]
        }
    
    def to_react_flow_format(self) -> dict:
        """
        Generate React Flow format.
        
        Auto-positions nodes using topological sort.
        Critical path edges are animated.
        """
        # Calculate positions using topological levels
        levels = self._calculate_levels()
        
        nodes = []
        for task in self.plan.tasks:
            level = levels.get(task.id, 0)
            # Position within level
            tasks_at_level = [t for t in self.plan.tasks if levels.get(t.id, 0) == level]
            pos_in_level = tasks_at_level.index(task)
            
            x = level * 200
            y = pos_in_level * 100
            
            is_critical = self._is_critical(task.id)
            
            nodes.append({
                "id": task.id,
                "type": "taskNode",
                "data": {
                    "label": task.description,
                    "duration": task.pert_duration,
                    "critical": is_critical,
                    "status": task.status,
                },
                "position": {"x": x, "y": y},
                "style": {
                    "border": "2px solid #ff6b6b" if is_critical else "1px solid #339af0",
                    "background": self._status_color(task.status),
                    "borderRadius": "8px",
                    "padding": "10px",
                }
            })
        
        edges = []
        edge_id = 0
        for task in self.plan.tasks:
            for pred in task.predecessors:
                is_critical = self._is_critical(pred) and self._is_critical(task.id)
                edges.append({
                    "id": f"e{edge_id}",
                    "source": pred,
                    "target": task.id,
                    "animated": is_critical,
                    "style": {"stroke": "#ff6b6b" if is_critical else "#adb5bd"},
                })
                edge_id += 1
        
        return {
            "nodes": nodes,
            "edges": edges,
            "viewport": {"x": 0, "y": 0, "zoom": 1},
        }
    
    def to_dot_format(self) -> str:
        """
        Generate Graphviz DOT format.
        
        Can be rendered to SVG/PDF with: dot -Tsvg plan.dot -o plan.svg
        """
        lines = [
            "digraph G {",
            "  rankdir=TB;",
            "  node [shape=box style=filled fontname=Arial];",
            "",
        ]
        
        # Nodes
        for task in self.plan.tasks:
            is_critical = self._is_critical(task.id)
            color = "#ff6b6b" if is_critical else "#74c0fc"
            label = f"{task.description}\\n{task.pert_duration:.1f}h"
            if is_critical:
                label += " ⚠️"
            lines.append(f'  {task.id} [label="{label}" fillcolor="{color}"];')
        
        lines.append("")
        
        # Edges
        for task in self.plan.tasks:
            for pred in task.predecessors:
                is_critical = self._is_critical(pred) and self._is_critical(task.id)
                style = "" if is_critical else ' [style=dashed]'
                lines.append(f"  {pred} -> {task.id}{style};")
        
        lines.append("}")
        
        return "\n".join(lines)
    
    def to_ascii(self) -> str:
        """
        Generate ASCII art diagram for terminal output.
        
        Shows task hierarchy with critical path indicators.
        """
        lines = []
        
        # Group tasks by level
        levels = self._calculate_levels()
        max_level = max(levels.values()) if levels else 0
        
        for level in range(max_level + 1):
            tasks_at_level = [t for t in self.plan.tasks if levels.get(t.id, 0) == level]
            
            for task in tasks_at_level:
                is_critical = self._is_critical(task.id)
                critical_marker = " ⚠️ CRITICAL" if is_critical else ""
                status_icon = self._status_icon(task.status)
                lines.append(f"┌{'─' * 40}┐")
                lines.append(f"│ {task.id}: {task.description[:30]:<30} │")
                lines.append(f"│ ({task.pert_duration:.1f}h){critical_marker:<24} │")
                lines.append(f"└{'─' * 40}┘ {status_icon}")
                
                # Show connections to next level
                dependents = [t for t in self.plan.tasks if task.id in t.predecessors]
                if dependents:
                    if len(dependents) == 1:
                        lines.append("         │")
                    else:
                        lines.append("    ┌────┴────┐")
                        for i, dep in enumerate(dependents):
                            prefix = "    │" if i < len(dependents) - 1 else "    "
                            lines.append(f"{prefix}         ▼")
            
            if level < max_level:
                lines.append("")
        
        return "\n".join(lines)
    
    def to_json(self, format: str = "default") -> str:
        """Export plan as JSON string."""
        if format == "d3":
            data = self.to_d3_format()
        elif format == "cytoscape":
            data = self.to_cytoscape_format()
        elif format == "react-flow":
            data = self.to_react_flow_format()
        else:
            # Default format
            data = {
                "tasks": [
                    {
                        "id": t.id,
                        "description": t.description,
                        "predecessors": t.predecessors,
                        "pert_duration": t.pert_duration,
                        "critical": self._is_critical(t.id),
                        "status": t.status,
                    }
                    for t in self.plan.tasks
                ],
                "critical_path": self.plan.critical_path,
                "total_duration": self.plan.total_duration,
                "parallelism_groups": self.plan.parallelism_groups,
            }
        
        return json.dumps(data, indent=2)
    
    def _calculate_levels(self) -> dict[str, int]:
        """Calculate topological levels for positioning."""
        levels = {}
        
        def get_level(task_id: str) -> int:
            if task_id in levels:
                return levels[task_id]
            
            task = self._task_map.get(task_id)
            if not task or not task.predecessors:
                levels[task_id] = 0
                return 0
            
            max_pred_level = max(get_level(pred) for pred in task.predecessors)
            levels[task_id] = max_pred_level + 1
            return levels[task_id]
        
        for task in self.plan.tasks:
            get_level(task.id)
        
        return levels

    def _dependents_of(self, task_id: str) -> list[Task]:
        """Return tasks that depend directly on the given task."""
        return [task for task in self.plan.tasks if task_id in task.predecessors]

    @staticmethod
    def _duration_to_mermaid_minutes(hours: float) -> str:
        """Convert hours to Mermaid gantt duration in minutes."""
        return f"{max(1, round(hours * 60))}m"

    @staticmethod
    def _sanitize_mermaid_gantt_label(label: str) -> str:
        """Remove characters that conflict with Mermaid gantt task syntax."""
        return " ".join(label.replace(",", " ").replace(":", " - ").split())

    
    def _status_color(self, status: str) -> str:
        """Get background color for task status."""
        colors = {
            "pending": "#f8f9fa",
            "running": "#74c0fc",
            "completed": "#51cf66",
            "failed": "#ff6b6b",
        }
        return colors.get(status, "#f8f9fa")
    
    def _status_icon(self, status: str) -> str:
        """Get icon for task status."""
        icons = {
            "pending": "⏳",
            "running": "🔄",
            "completed": "✅",
            "failed": "❌",
        }
        return icons.get(status, "❓")


# Convenience functions
def to_mermaid(
    plan: Plan,
    timings: Optional[dict] = None,
    style: Literal["flowchart", "classic-pert", "pert-gantt"] = "flowchart",
    milestone_label: Optional[str] = None,
) -> str:
    """Quick export to Mermaid format."""
    return Visualizer(plan, timings).to_mermaid(style=style, milestone_label=milestone_label)


def to_d3(plan: Plan, timings: Optional[dict] = None) -> dict:
    """Quick export to D3.js format."""
    return Visualizer(plan, timings).to_d3_format()


def to_cytoscape(plan: Plan, timings: Optional[dict] = None) -> dict:
    """Quick export to Cytoscape.js format."""
    return Visualizer(plan, timings).to_cytoscape_format()


def to_react_flow(plan: Plan, timings: Optional[dict] = None) -> dict:
    """Quick export to React Flow format."""
    return Visualizer(plan, timings).to_react_flow_format()


def to_dot(plan: Plan, timings: Optional[dict] = None) -> str:
    """Quick export to Graphviz DOT format."""
    return Visualizer(plan, timings).to_dot_format()


def to_ascii(plan: Plan, timings: Optional[dict] = None) -> str:
    """Quick export to ASCII art."""
    return Visualizer(plan, timings).to_ascii()
