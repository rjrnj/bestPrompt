import { describe, expect, it } from "vitest";
import {
  parseTemplate,
  renderTemplate,
  TemplateSyntaxError,
  validateTemplate,
} from "./template";

function errorsOf(src: string) {
  const result = parseTemplate(src);
  return result.ok ? [] : result.errors;
}

describe("parseTemplate", () => {
  it("parses text, placeholders and blocks into nodes", () => {
    expect(parseTemplate("a{{b}}{{#c}}d{{/c}}")).toEqual({
      ok: true,
      nodes: [
        { type: "text", value: "a" },
        { type: "placeholder", key: "b", offset: 1 },
        {
          type: "block",
          key: "c",
          offset: 6,
          children: [{ type: "text", value: "d" }],
        },
      ],
    });
  });

  it("allows whitespace inside a tag", () => {
    expect(parseTemplate("{{ a }}{{# b }}{{/ b }}")).toEqual({
      ok: true,
      nodes: [
        { type: "placeholder", key: "a", offset: 0 },
        { type: "block", key: "b", offset: 7, children: [] },
      ],
    });
  });

  it("reports an unclosed block with the offset of its opening tag", () => {
    expect(errorsOf("x {{#a}}y")).toEqual([
      { message: "Block {{#a}} is never closed", offset: 2 },
    ]);
  });

  it("reports a closing tag that does not match the open block", () => {
    expect(errorsOf("{{#a}}{{/b}}")).toEqual([
      { message: "{{/b}} closes {{#a}}; expected {{/a}}", offset: 6 },
    ]);
  });

  it("reports a closing tag with no open block", () => {
    expect(errorsOf("x{{/a}}")).toEqual([
      { message: "{{/a}} has no matching {{#a}}", offset: 1 },
    ]);
  });

  it("reports a tag that is never closed", () => {
    expect(errorsOf("ab {{key")).toEqual([
      { message: "Tag is missing its closing }}", offset: 3 },
    ]);
  });

  it("reports an empty tag", () => {
    expect(errorsOf("{{}}")).toEqual([
      { message: "Tag has no key", offset: 0 },
    ]);
    expect(errorsOf("{{#}}")).toEqual([
      { message: "Tag has no key", offset: 0 },
    ]);
  });

  it("reports a key containing whitespace or braces", () => {
    expect(errorsOf("{{a b}}")).toEqual([
      { message: 'Invalid key "a b"', offset: 0 },
    ]);
    expect(errorsOf("{{a{b}}")).toEqual([
      { message: 'Invalid key "a{b"', offset: 0 },
    ]);
  });

  it("treats a backslash before {{ as a literal {{", () => {
    expect(parseTemplate("say \\{{hi}} to {{a}}")).toEqual({
      ok: true,
      nodes: [
        { type: "text", value: "say {{hi}} to " },
        { type: "placeholder", key: "a", offset: 15 },
      ],
    });
  });

  it("keeps any other backslash as text", () => {
    expect(parseTemplate("C:\\dir\\{x}")).toEqual({
      ok: true,
      nodes: [{ type: "text", value: "C:\\dir\\{x}" }],
    });
  });
});

describe("renderTemplate", () => {
  it("throws TemplateSyntaxError on a template that does not parse", () => {
    expect(() => renderTemplate("{{#a}}", {})).toThrow(TemplateSyntaxError);
    expect(() => renderTemplate("{{#a}}", {})).toThrow(
      "Block {{#a}} is never closed",
    );
  });

  it("renders a literal {{ from its escape", () => {
    expect(renderTemplate("\\{{not a tag}} {{a}}", { a: "v" })).toBe(
      "{{not a tag}} v",
    );
  });

  it("renders non-ASCII text in the template and the values", () => {
    expect(
      renderTemplate("Rôle: {{role}} — 目标: {{goal}} 🎯", {
        role: "réviseur",
        goal: "改善",
      }),
    ).toBe("Rôle: réviseur — 目标: 改善 🎯");
  });

  describe("output cleanup", () => {
    it("collapses three or more newlines left by a dropped block to two", () => {
      const template = "# A\n{{a}}\n\n{{#b}}# B\n{{b}}{{/b}}\n\n# C\n{{c}}";
      expect(renderTemplate(template, { a: "1", b: "", c: "3" })).toBe(
        "# A\n1\n\n# C\n3",
      );
    });

    it("keeps a run of two newlines", () => {
      expect(renderTemplate("a\n\nb", {})).toBe("a\n\nb");
    });

    it("trims whitespace from the start and end of the output", () => {
      expect(
        renderTemplate("\n\n{{#a}}# A\n{{a}}{{/a}}\n\n{{#b}}# B{{/b}}\n", {
          a: "1",
        }),
      ).toBe("# A\n1");
    });

    it("trims whitespace around a value", () => {
      expect(renderTemplate("[{{a}}]", { a: "  padded\n\n" })).toBe("[padded]");
    });

    it("normalizes CRLF line endings in the template and the values", () => {
      expect(
        renderTemplate("# A\r\n{{a}}\r\n\r\n# B\r\n{{b}}", {
          a: "line 1\r\nline 2",
          b: "x",
        }),
      ).toBe("# A\nline 1\nline 2\n\n# B\nx");
    });
  });
});

describe("validateTemplate", () => {
  const keys = ["role", "task"];

  it("returns no errors for a template that only uses known keys", () => {
    expect(
      validateTemplate("{{#role}}{{role}}{{/role}} {{task}}", keys),
    ).toEqual([]);
  });

  it("reports each use of an unknown key with its offset", () => {
    expect(
      validateTemplate("{{role}} {{#format}}{{format}}{{/format}}", keys),
    ).toEqual([
      { message: 'Unknown key "format"', offset: 9 },
      { message: 'Unknown key "format"', offset: 20 },
    ]);
  });

  it("reports an unknown key inside a nested block", () => {
    expect(
      validateTemplate("{{#role}}{{#tone}}{{/tone}}{{/role}}", keys),
    ).toEqual([{ message: 'Unknown key "tone"', offset: 9 }]);
  });

  it("reports syntax errors", () => {
    expect(validateTemplate("{{#role}}", keys)).toEqual([
      { message: "Block {{#role}} is never closed", offset: 0 },
    ]);
  });

  it("substitutes a placeholder with its value", () => {
    expect(renderTemplate("Hello {{name}}!", { name: "world" })).toBe(
      "Hello world!",
    );
  });

  it("renders a placeholder with no value as nothing", () => {
    expect(renderTemplate("A{{missing}}B", {})).toBe("AB");
  });

  describe("optional blocks", () => {
    const template = "Before {{#role}}Role: {{role}}.{{/role}} After";

    it("keeps the block, with substitution, when the value is filled", () => {
      expect(renderTemplate(template, { role: "a reviewer" })).toBe(
        "Before Role: a reviewer. After",
      );
    });

    it("drops the block when the value is empty", () => {
      expect(renderTemplate(template, { role: "" })).toBe("Before  After");
    });

    it("drops the block when the value is only whitespace", () => {
      expect(renderTemplate(template, { role: " \n\t " })).toBe(
        "Before  After",
      );
    });

    it("drops the block when the key has no value", () => {
      expect(renderTemplate(template, {})).toBe("Before  After");
    });

    it("drops a nested block on its own when only its key is blank", () => {
      expect(
        renderTemplate("{{#a}}[{{a}}{{#b}} and {{b}}{{/b}}]{{/a}}", {
          a: "x",
          b: "",
        }),
      ).toBe("[x]");
    });

    it("drops a nested block with its parent", () => {
      expect(
        renderTemplate("{{#a}}[{{a}}{{#b}} and {{b}}{{/b}}]{{/a}}", {
          a: "",
          b: "y",
        }),
      ).toBe("");
    });
  });
});
