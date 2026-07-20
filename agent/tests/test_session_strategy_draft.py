"""Regression tests for extracting strategy drafts from agent replies."""

from __future__ import annotations

import api_server


def test_extract_agent_strategy_candidate_from_python_fence() -> None:
    content = """# Mean Reversion Strategy

Use z-score entries with risk controls.

```python
class SignalEngine:
    def generate(self, data):
        return {}
```
"""

    candidate = api_server._extract_agent_strategy_candidate(content)

    assert candidate is not None
    assert candidate["name"] == "Mean Reversion Strategy"
    assert candidate["language"] == "python"
    assert candidate["tags"] == ["agent"]
    assert "class SignalEngine" in candidate["code"]
    assert "Use z-score entries" in candidate["strategyDescription"]
    assert "```python" not in candidate["strategyDescription"]


def test_extract_agent_strategy_candidate_ignores_incomplete_code() -> None:
    content = """Strategy: Notes only

```python
print("not a strategy")
```
"""

    assert api_server._extract_agent_strategy_candidate(content) is None
