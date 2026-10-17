import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Project } from "../bindings/Project";
import { ProjectSelect } from "./ProjectSelect";

function project(id: string, name: string): Project {
  return { id, name, createdAt: 1, updatedAt: 1 };
}

const api = project("0192f000-0000-7000-8000-000000000001", "api");
const web = project("0192f000-0000-7000-8000-000000000002", "web");

function renderSelect(value: string | null) {
  const onChange = vi.fn();
  const onNew = vi.fn();
  render(
    <ProjectSelect
      projects={[api, web]}
      value={value}
      onChange={onChange}
      label="Project"
      extraItems={[{ value: "new", label: "New project…", onSelect: onNew }]}
    />,
  );
  return { onChange, onNew };
}

describe("ProjectSelect", () => {
  it("lists the projects, then No project, then the extra items", async () => {
    renderSelect(null);
    const user = userEvent.setup();

    const trigger = screen.getByRole("combobox", { name: "Project" });
    expect(trigger).toHaveTextContent("No project");
    await user.click(trigger);

    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "api",
      "web",
      "No project",
      "New project…",
    ]);
  });

  it("reports the chosen project, or null for No project", async () => {
    const { onChange } = renderSelect(api.id);
    const user = userEvent.setup();
    const trigger = screen.getByRole("combobox", { name: "Project" });
    expect(trigger).toHaveTextContent("api");

    await user.click(trigger);
    await user.click(await screen.findByRole("option", { name: "web" }));
    expect(onChange).toHaveBeenLastCalledWith(web.id);

    await user.click(trigger);
    await user.click(await screen.findByRole("option", { name: "No project" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("runs an extra item's action and keeps the value", async () => {
    const { onChange, onNew } = renderSelect(web.id);
    const user = userEvent.setup();
    const trigger = screen.getByRole("combobox", { name: "Project" });

    await user.click(trigger);
    await user.click(
      await screen.findByRole("option", { name: "New project…" }),
    );

    expect(onNew).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger).toHaveTextContent("web");
  });
});
