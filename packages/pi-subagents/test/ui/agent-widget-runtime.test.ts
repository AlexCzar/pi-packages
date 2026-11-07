import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentTypeRegistry } from "#src/config/agent-types";
import type { Subagent } from "#src/lifecycle/subagent";
import type { SubagentManager } from "#src/lifecycle/subagent-manager";
import { AgentWidget, type UICtx } from "#src/ui/agent-widget";
import { makeModel } from "#test/helpers/make-model";
import { createTestSubagent, makeStubExecution } from "#test/helpers/make-subagent";
import { createMockSession, createSubagentSessionStub, toSubagentSession } from "#test/helpers/mock-session";

function mountWidget(record: Subagent) {
	const manager = { listAgents: () => [record] } as unknown as SubagentManager;
	const widget = new AgentWidget(manager, new AgentTypeRegistry(() => new Map()));
	const setWidget = vi.fn<UICtx["setWidget"]>();
	widget.setUICtx({ setStatus: () => {}, setWidget });
	widget.update();
	const factory = setWidget.mock.lastCall?.[1];
	if (!factory) throw new Error("Expected the agents widget to be registered");
	const component = factory(
		{ terminal: { columns: 200, rows: 40 }, mode: "regular", requestRender: () => {} },
		{ fg: (_color, text) => text, bold: text => text },
	);
	return { widget, component };
}

const model = makeModel({ provider: "anthropic", id: "claude-sonnet-5" });

describe("AgentWidget runtime label", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(6000);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe.each(["running", "completed"] as const)("%s agent", status => {
		it.each(["high", "off"] as const)("shows effective thinking %s beside the model", thinkingLevel => {
			const record = createTestSubagent({
				status,
				result: status === "running" ? undefined : "Done",
				completedAt: status === "running" ? undefined : 5000,
				execution: makeStubExecution({ model, thinkingLevel }),
			});
			const { widget, component } = mountWidget(record);

			// Assert the runtime tag independently of the existing activity and stats rendering.
			expect(component.render().join("\n")).toContain(`[anthropic/claude-sonnet-5 · thinking: ${thinkingLevel}]`);
			widget.dispose();
		});

		it("keeps the model alone when the thinking level is unknown", () => {
			const record = createTestSubagent({
				status,
				result: status === "running" ? undefined : "Done",
				completedAt: status === "running" ? undefined : 5000,
				execution: makeStubExecution({ model }),
			});
			const { widget, component } = mountWidget(record);

			const text = component.render().join("\n");
			expect(text).toContain("[anthropic/claude-sonnet-5]");
			expect(text).not.toContain("thinking:");
			widget.dispose();
		});
	});

	it("follows the live session rather than the requested level and retains it after release", async () => {
		const record = createTestSubagent({
			execution: makeStubExecution({ model, thinkingLevel: "low" }),
		});
		const session = createMockSession({ model, thinkingLevel: "high" });
		record.subagentSession = toSubagentSession(createSubagentSessionStub(session));
		const { widget, component } = mountWidget(record);

		expect(component.render().join("\n")).toContain("[anthropic/claude-sonnet-5 · thinking: high]");
		session.thinkingLevel = "off";
		expect(component.render().join("\n")).toContain("[anthropic/claude-sonnet-5 · thinking: off]");

		await record.releaseSession();

		expect(component.render().join("\n")).toContain("[anthropic/claude-sonnet-5 · thinking: off]");
		widget.dispose();
	});
});
