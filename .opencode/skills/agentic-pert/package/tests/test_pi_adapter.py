from pathlib import Path

from agentic_pert import Task
from agentic_pert.adapters.pi import PiAgentExecutor


def test_pi_build_command_includes_json_mode_and_tools(tmp_path):
    executor = PiAgentExecutor(
        model="local/test-model",
        tools=["read", "grep"],
        session_dir=str(tmp_path),
    )
    task = Task(id="T1", description="Inspect repository")
    session_file = executor._session_file(task)

    command = executor._build_command(task, session_file)

    assert command[:3] == ["pi", "--mode", "json"]
    assert "--session" in command
    assert str(session_file) in command
    assert "--model" in command
    assert "local/test-model" in command
    assert "--tools" in command
    assert "read,grep" in command
    assert command[-1] == "Inspect repository"


def test_pi_parse_json_stream_extracts_text_and_tool_count():
    stdout = "\n".join(
        [
            '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"Hello "}}',
            '{"type":"tool_execution_start","toolName":"read"}',
            '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"world"}}',
        ]
    )

    output, tool_count = PiAgentExecutor._parse_json_stream(stdout)

    assert output == "Hello world"
    assert tool_count == 1
