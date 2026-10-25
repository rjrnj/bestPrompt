import { describe, expect, it } from "vitest";
import { autoTemplate, sectionBlock } from "./frameworks/autoTemplate";
import {
  insertPlaceholder,
  parseTemplate,
  removeSectionFromTemplate,
  renderTemplate,
  TemplateSyntaxError,
  referencedKeys,
  usedKeys,
  validateTemplate,
} from "./template";

function errorsOf(src: string) {
  const result = parseTemplate(src);
  return result.ok ? [] : result.errors;
}

/** A fixed-seed linear congruential generator, so random cases repeat run to run. */
function seeded(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  return {
    below: (n: number) => Math.floor(next() * n),
    pick: <T>(items: readonly T[]): T =>
      items[Math.floor(next() * items.length)],
  };
}

type Random = ReturnType<typeof seeded>;

const randomSections = ["a", "b", "c"].map((key) => ({
  key,
  label: key.toUpperCase(),
  helpText: "",
}));

/** A template built from random pieces that use the keys of `randomSections`. */
function randomTemplate(random: Random, depth = 0): string {
  // Words, newline runs and generated blocks come up most, as the joins
  // around a removed block are where it can go wrong.
  const word = () => random.pick(["word", "Go", "x y"]);
  const newlines = () => random.pick(["\n", "\n", "\n\n", "\n\n\n"]);
  // A generated block keeps its heading when its section is renamed by hand.
  const generated = () =>
    sectionBlock({
      ...random.pick(randomSections),
      label: random.pick(["A", "Bee", "x y"]),
    });
  const pieces: ((key: string) => string)[] = [
    word,
    word,
    newlines,
    newlines,
    newlines,
    () => " ",
    generated,
    generated,
    generated,
    (key) => `{{${key}}}`,
    () => "\\{{lit}}",
    (key) => `\\{{${key}}}`,
    (key) => `\\\\{{${key}}}`,
    () => random.pick(["\\", "{", "}", "{}"]),
  ];
  // Hand-written blocks, nested at most two deep.
  if (depth < 2) {
    pieces.push(
      (key) => `{{#${key}}}${randomTemplate(random, depth + 1)}{{/${key}}}`,
    );
  }
  let out = "";
  const count = random.below(depth === 0 ? 9 : 4);
  for (let i = 0; i < count; i++) {
    out += random.pick(pieces)(random.pick(randomSections).key);
  }
  return out;
}

/** Random values for the keys of `randomSections`, some of them blank. */
function randomValues(random: Random): Record<string, string> {
  const values: Record<string, string> = {};
  for (const { key } of randomSections) {
    values[key] = random.pick(["", " ", "V", "two\nlines"]);
  }
  return values;
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

  it("treats a doubled backslash before {{ as one backslash and a tag", () => {
    expect(parseTemplate("C:\\Users\\\\{{user}}")).toEqual({
      ok: true,
      nodes: [
        { type: "text", value: "C:\\Users\\" },
        { type: "placeholder", key: "user", offset: 10 },
      ],
    });
  });

  it("treats three backslashes before {{ as one backslash and a literal {{", () => {
    expect(parseTemplate("\\\\\\{{x}}")).toEqual({
      ok: true,
      nodes: [{ type: "text", value: "\\{{x}}" }],
    });
  });

  it("keeps }} outside a tag as text", () => {
    expect(parseTemplate("a }} b {{k}}}")).toEqual({
      ok: true,
      nodes: [
        { type: "text", value: "a }} b " },
        { type: "placeholder", key: "k", offset: 7 },
        { type: "text", value: "}" },
      ],
    });
  });
});

describe("renderTemplate", () => {
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

  it("renders a key named like an Object.prototype member", () => {
    expect(renderTemplate("[{{constructor}}]", {})).toBe("[]");
    expect(renderTemplate("[{{#toString}}x{{/toString}}]", {})).toBe("[]");
    expect(renderTemplate("[{{__proto__}}]", { ["__proto__"]: "p" })).toBe(
      "[p]",
    );
  });

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

    it("drops a value's leading blank lines and trailing whitespace", () => {
      expect(renderTemplate("[{{a}}]", { a: " \n\n  padded  \n\n" })).toBe(
        "[  padded]",
      );
    });
    it("keeps a value's first-line indentation", () => {
      expect(
        renderTemplate("[{{a}}]", { a: "\n    def f():\n        pass\n" }),
      ).toBe("[    def f():\n        pass]");
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
});

describe("usedKeys", () => {
  it("finds placeholders at any depth", () => {
    expect(usedKeys("{{a}} {{#b}}x {{c}} {{#d}}{{e}}{{/d}}{{/b}}")).toEqual(
      new Set(["a", "c", "e"]),
    );
  });

  it("does not count a key that only opens a block", () => {
    expect(usedKeys("{{#a}}text{{/a}}")).toEqual(new Set());
  });

  it("is empty when the template does not parse", () => {
    expect(usedKeys("{{a}} {{#b}}")).toEqual(new Set());
  });
});

describe("referencedKeys", () => {
  it("finds placeholders and block keys at any depth", () => {
    expect(
      referencedKeys("{{a}} {{#b}}x {{c}} {{#d}}{{e}}{{/d}}{{/b}}"),
    ).toEqual(new Set(["a", "b", "c", "d", "e"]));
  });

  it("counts a key that only opens a block", () => {
    expect(referencedKeys("{{#a}}text{{/a}}")).toEqual(new Set(["a"]));
  });

  it("is empty when the template does not parse", () => {
    expect(referencedKeys("{{a}} {{#b}}")).toEqual(new Set());
  });
});

describe("removeSectionFromTemplate", () => {
  const role = { key: "role", label: "Role", helpText: "" };
  const task = { key: "task", label: "Task", helpText: "" };
  const goal = { key: "goal", label: "Goal", helpText: "" };

  describe("carried offsets", () => {
    const role = { key: "role", label: "Role", helpText: "" };
    const task = { key: "task", label: "Task", helpText: "" };
    const template = `Act as {{role}} now.\n\n${sectionBlock(task)}\n\nThen {{goal}} ends.`;

    it("shifts by the text removed before them", () => {
      const carry = [
        template.indexOf("{{role}}"),
        template.indexOf("{{goal}}"),
      ];
      const out = removeSectionFromTemplate(template, task.key, carry);
      expect(out.template).toBe("Act as {{role}} now.\n\nThen {{goal}} ends.");
      expect(out.spots).toEqual([
        out.template.indexOf("{{role}}"),
        out.template.indexOf("{{goal}}"),
      ]);
    });

    it("drops the ones inside a removed block or placeholder", () => {
      const inBlock = template.indexOf("{{task}}");
      const inRole = template.indexOf("{{role}}") + 2;
      const carry = [inRole, inBlock, template.indexOf("{{goal}}")];
      const out = removeSectionFromTemplate(template, task.key, carry);
      expect(out.spots).toEqual([
        out.template.indexOf("{{role}}") + 2,
        out.template.indexOf("{{goal}}"),
      ]);
      const gone = removeSectionFromTemplate(template, role.key, carry);
      expect(gone.spots).toEqual([
        "Act as ".length,
        gone.template.indexOf("{{task}}"),
        gone.template.indexOf("{{goal}}"),
      ]);
    });

    it("merges with the new spots without repeats, ascending", () => {
      const carry = [template.indexOf("{{goal}}"), 3];
      const out = removeSectionFromTemplate(template, role.key, carry);
      const spots = out.spots;
      expect(spots).toEqual([...new Set(spots)].sort((a, b) => a - b));
      expect(spots).toContain("Act as ".length);
      expect(spots).toContain(3);
    });

    it("keeps one that stood exactly where a later cut starts", () => {
      const a = { key: "a", label: "A", helpText: "" };
      const b = { key: "b", label: "B", helpText: "" };
      const first = removeSectionFromTemplate("{{a}}{{#b}}x{{/b}} tail", a.key);
      expect(first).toEqual({ template: "{{#b}}x{{/b}} tail", spots: [0] });
      expect(
        removeSectionFromTemplate(first.template, b.key, first.spots),
      ).toEqual({ template: " tail", spots: [0] });
    });

    it("keeps them when the template does not parse", () => {
      expect(removeSectionFromTemplate("{{role", role.key, [2, 1])).toEqual({
        template: "{{role",
        spots: [1, 2],
      });
    });
  });

  describe("what stays renders as before", () => {
    // Removing a section must not change how the rest renders: the result
    // reads like the template rendered with that section left blank.
    const values = { other: "O" };
    const blank = { ...values, goal: "" };
    const slashes = (n: number) => "\\".repeat(n);
    const block = sectionBlock(goal);
    // `block`: the piece ends with the generated block. Followed by a line
    // break, the longer of the newline runs around it stays, so a blank line
    // on either side still parts the paragraphs. Followed by text on the same
    // line, the blank line stays too, and a spot marks where the text joins;
    // so it does where text precedes the block on its line.
    // Rendering trims the ends, so a run dropped at either end still matches.
    const pieces: {
      name: string;
      piece: string;
      block?: boolean;
      joined?: boolean;
    }[] = [
      { name: "a placeholder", piece: "{{goal}}" },
      { name: "a generated block", piece: block, block: true, joined: true },
      { name: "a block between blank lines", piece: `\n\n${block}\n\n` },
      {
        name: "a block after a blank line",
        piece: `\n\n${block}`,
        block: true,
      },
      { name: "a block before a blank line", piece: `${block}\n\n` },
      { name: "a hand-written block", piece: "{{#goal}}see {{goal}}{{/goal}}" },
      { name: "two placeholders", piece: "{{goal}}\\\\{{goal}}" },
      { name: "a block and an escaped tag", piece: `${block}\\{{goal}}` },
    ];
    const rights = [
      "",
      "\ntail",
      "\n\ntail",
      // The rest are on the same line as the piece.
      "tail",
      "{",
      "{other}}",
      "{{other}}",
      "\\{{lit}}",
      "\\{{other}}",
      "\\\\{{other}}",
      "\\\\\\{{other}}",
      "\\tail",
      "\\\\tail",
    ];
    const cases = pieces.flatMap(({ name, piece, block, joined }) =>
      [0, 1, 2, 3].flatMap((n) =>
        rights.map((right) => ({
          name: `${n} backslashes, ${name}, then ${JSON.stringify(right)}`,
          template: `C:${slashes(n)}${piece}${right}`,
          block: block === true,
          sameLine:
            joined === true || (right !== "" && !right.startsWith("\n")),
        })),
      ),
    );

    it.each(cases)("$name", ({ template, block, sameLine }) => {
      const { template: out, spots } = removeSectionFromTemplate(
        template,
        goal.key,
      );
      if (!parseTemplate(template).ok) {
        expect(out).toBe(template);
        return;
      }
      expect(spots.every((spot) => spot <= out.length)).toBe(true);
      if (block) expect(spots.length > 0).toBe(sameLine);
      expect(renderTemplate(out, values)).toBe(renderTemplate(template, blank));
    });

    it("keeps an escaped {{ escaped after a backslash the block followed", () => {
      const template = `C:\\\n\n${block}\\{{lit}}`;
      const out = removeSectionFromTemplate(template, goal.key).template;
      expect(renderTemplate(out, {})).toBe("C:\\\n\n{{lit}}");
      expect(usedKeys(out)).toEqual(new Set());
    });

    it("keeps one backslash where a doubled one stood before the placeholder", () => {
      const out = removeSectionFromTemplate(
        "a\\\\{{goal}}x",
        goal.key,
      ).template;
      expect(renderTemplate(out, {})).toBe("a\\x");
      expect(out).toBe("a\\x");
    });

    it("leaves an escaped tag that only looks like the section's", () => {
      expect(removeSectionFromTemplate("a\\{{goal}}x", goal.key).template).toBe(
        "a\\{{goal}}x",
      );
    });

    it("leaves the blank line when dropping it would make a new tag", () => {
      const template = `x{\n\n${block}{other}}`;
      const out = removeSectionFromTemplate(template, goal.key).template;
      expect(usedKeys(out)).toEqual(new Set());
      expect(renderTemplate(out, values)).toBe(renderTemplate(template, blank));
    });

    it("keeps paragraphs apart when text follows the block on its line", () => {
      const template = `You are an expert.\n\n${block} Answer in {{tone}} tone.`;
      expect(removeSectionFromTemplate(template, goal.key)).toEqual({
        template: "You are an expert.\n\n Answer in {{tone}} tone.",
        spots: ["You are an expert.\n\n".length],
      });
      expect(removeSectionFromTemplate(`a\n\n${block}{`, goal.key)).toEqual({
        template: "a\n\n{",
        spots: [3],
      });
    });
  });

  it("marks where text before the block on its line is left", () => {
    const template = `Intro: ${sectionBlock(goal)}\n\nNext`;
    expect(removeSectionFromTemplate(template, goal.key)).toEqual({
      template: "Intro: \n\nNext",
      spots: ["Intro: ".length],
    });
    expect(
      removeSectionFromTemplate(`Intro: ${sectionBlock(goal)}`, goal.key),
    ).toEqual({
      template: "Intro: ",
      spots: ["Intro: ".length],
    });
  });

  it("keeps a literal backslash literal when the text after it starts a tag", () => {
    const a = { key: "a", label: "A", helpText: "" };
    const template = "C:\\\n\n{{#a}}# A\n{{a}}{{/a}}{{b}}";
    const out = removeSectionFromTemplate(template, a.key).template;
    expect(parseTemplate(out).ok).toBe(true);
    expect(usedKeys(out).has("b")).toBe(true);
    expect(renderTemplate(out, { b: "x" })).toBe("C:\\\n\nx");
  });

  it("keeps one blank line when the block sat after a single newline", () => {
    const a = { key: "a", label: "A", helpText: "" };
    const template = "Intro\n" + sectionBlock(a) + "\n\nRest {{b}}";
    expect(removeSectionFromTemplate(template, a.key).template).toBe(
      "Intro\n\nRest {{b}}",
    );
  });

  it("keeps a blank line when one newline sits on each side of the block", () => {
    const k = { key: "k", label: "K", helpText: "" };
    const template = "Intro\n" + sectionBlock(k) + "\nOutro";
    expect(removeSectionFromTemplate(template, k.key)).toEqual({
      template: "Intro\n\nOutro",
      spots: [],
    });
    expect(renderTemplate(template, {})).toBe("Intro\n\nOutro");
  });

  it("keeps the blank line before the block when one newline follows it", () => {
    const a = { key: "a", label: "A", helpText: "" };
    const template = `${sectionBlock(a)}\n\n${sectionBlock(goal)}\nSome instruction.`;
    expect(removeSectionFromTemplate(template, goal.key)).toEqual({
      template: `${sectionBlock(a)}\n\nSome instruction.`,
      spots: [],
    });
  });

  it("leaves newline runs the author wrote away from the cut", () => {
    const a = { key: "a", label: "A", helpText: "" };
    const template = "X\n\n\n\nY\n\n" + sectionBlock(a) + "\n\nZ\n\n\n\nW";
    expect(removeSectionFromTemplate(template, a.key).template).toBe(
      "X\n\n\n\nY\n\nZ\n\n\n\nW",
    );
  });

  it("removes the generated block and the separator after it", () => {
    const template = autoTemplate([role, task, goal]);
    expect(removeSectionFromTemplate(template, role.key)).toEqual({
      template: autoTemplate([task, goal]),
      spots: [],
    });
  });

  it("removes the separator before a middle or last block", () => {
    const template = autoTemplate([role, task, goal]);
    expect(removeSectionFromTemplate(template, task.key).template).toBe(
      autoTemplate([role, goal]),
    );
    expect(removeSectionFromTemplate(template, goal.key).template).toBe(
      autoTemplate([role, task]),
    );
  });

  it("keeps one blank line when a renamed block is removed from between two", () => {
    const aim = { key: "goal", label: "Aim", helpText: "" };
    const template = [
      sectionBlock(role),
      sectionBlock(aim),
      sectionBlock(task),
    ].join("\n\n");
    const out = removeSectionFromTemplate(template, goal.key);
    expect(out).toEqual({ template: autoTemplate([role, task]), spots: [] });
  });

  it.each([
    {
      name: "a generated block under an old heading",
      template: "Intro\n\n{{#a}}# A\n{{a}}{{/a}}\n\n{{#b}}# B\n{{b}}{{/b}}",
      key: "b",
      expected: { template: "Intro\n\n{{#a}}# A\n{{a}}{{/a}}", spots: [] },
    },
    {
      name: "a placeholder on its own line",
      template: "P\n\n{{a}}\n\nQ",
      key: "a",
      expected: { template: "P\n\nQ", spots: [3] },
    },
    {
      name: "a hand-written block at the start",
      template: "{{#a}}x{{/a}}\n\nQ",
      key: "a",
      expected: { template: "Q", spots: [] },
    },
  ])("tidies the blank lines around $name", ({ template, key, expected }) => {
    expect(removeSectionFromTemplate(template, key)).toEqual(expected);
  });

  it("knows a generated block by its shape, whatever its heading says", () => {
    // Text before a generated block on its line is marked; before a
    // hand-written block it is not.
    expect(
      removeSectionFromTemplate("Intro {{#b}}# Bee\n{{b}}{{/b}}", "b"),
    ).toEqual({ template: "Intro ", spots: [6] });
    expect(
      removeSectionFromTemplate("Intro {{#b}}# Bee{{b}}{{/b}}", "b"),
    ).toEqual({ template: "Intro ", spots: [] });
    expect(
      removeSectionFromTemplate("Intro {{#b}}# B\n\n{{b}}{{/b}}", "b"),
    ).toEqual({ template: "Intro ", spots: [] });
  });

  it("removes only the block when text precedes it, and marks the join", () => {
    const template = `Intro ${sectionBlock(role)}\n\nNext`;
    expect(removeSectionFromTemplate(template, role.key)).toEqual({
      template: "Intro \n\nNext",
      spots: ["Intro ".length],
    });
  });

  it("removes a generated block nested inside another section's block", () => {
    const template = `{{#task}}${sectionBlock(role)}{{/task}}`;
    expect(removeSectionFromTemplate(template, role.key)).toEqual({
      template: "{{#task}}{{/task}}",
      spots: [9],
    });
  });

  it("leaves an empty template when the only block is removed", () => {
    expect(removeSectionFromTemplate(autoTemplate([role]), role.key)).toEqual({
      template: "",
      spots: [],
    });
  });

  it("removes a hand-written block whole with no spot", () => {
    expect(
      removeSectionFromTemplate("Hi {{#role}}as {{role}}{{/role}}!", role.key),
    ).toEqual({ template: "Hi !", spots: [] });
  });

  it("removes a loose placeholder and records where it was", () => {
    expect(
      removeSectionFromTemplate("I expected {{expected}}, but", "expected"),
    ).toEqual({ template: "I expected , but", spots: [11] });
  });

  it("records spots in the new template, in ascending order", () => {
    expect(
      removeSectionFromTemplate("a{{role}}b{{task}}c{{role}}d", role.key),
    ).toEqual({ template: "ab{{task}}cd", spots: [1, 11] });
  });

  it("removes a placeholder that sits inside another section's block", () => {
    expect(
      removeSectionFromTemplate("{{#task}}see {{role}} now{{/task}}", role.key),
    ).toEqual({ template: "{{#task}}see  now{{/task}}", spots: [13] });
  });

  it("leaves other sections untouched", () => {
    expect(
      removeSectionFromTemplate("{{task}} and {{goal}}", role.key),
    ).toEqual({
      template: "{{task}} and {{goal}}",
      spots: [],
    });
  });

  it("renders what stays as before, and leaves no new blank lines, for random templates", () => {
    const longestRun = (text: string) =>
      Math.max(0, ...(text.match(/\n+/g) ?? []).map((run) => run.length));
    const random = seeded(20240611);
    let parsed = 0;
    for (let i = 0; i < 20000; i++) {
      const template = randomTemplate(random);
      const values = randomValues(random);
      const ok = parseTemplate(template).ok;
      if (ok) parsed++;
      for (const section of randomSections) {
        const context = `${JSON.stringify(template)} without ${section.key}`;
        const out = removeSectionFromTemplate(template, section.key).template;
        if (!ok) {
          expect(out, context).toBe(template);
          continue;
        }
        expect(parseTemplate(out).ok, context).toBe(true);
        expect(renderTemplate(out, values), context).toBe(
          renderTemplate(template, { ...values, [section.key]: "" }),
        );
        // Tidy: no newline run longer than the template had, or a blank
        // line, and no newlines at either end that were not there before.
        expect(longestRun(out), context).toBeLessThanOrEqual(
          Math.max(longestRun(template), 2),
        );
        if (!template.startsWith("\n")) {
          expect(out.startsWith("\n"), context).toBe(false);
        }
        if (!template.endsWith("\n")) {
          expect(out.endsWith("\n"), context).toBe(false);
        }
      }
    }
    // Most random templates parse, so the property is really exercised.
    expect(parsed).toBeGreaterThan(10000);
  });

  it("returns a template that does not parse unchanged", () => {
    expect(removeSectionFromTemplate("{{role}} {{#task}}", role.key)).toEqual({
      template: "{{role}} {{#task}}",
      spots: [],
    });
  });
});

describe("insertPlaceholder", () => {
  const values = { goal: "VALUE" };

  it("puts the tag in the middle and the cursor after it", () => {
    expect(insertPlaceholder("ab", 1, 1, "goal")).toEqual({
      template: "a{{goal}}b",
      cursor: 9,
    });
  });

  it("is not drawn to the end by an unclosed {{ earlier on", () => {
    const before = "Intro {{ oops\n\nContext here";
    const template = `${before}\n\nMore text`;

    expect(
      insertPlaceholder(template, before.length, before.length, "goal"),
    ).toEqual({
      template: `${before}{{goal}}\n\nMore text`,
      cursor: before.length + 8,
    });
  });

  it("goes before an unclosed {{ when the cursor is between its braces", () => {
    const missing = "Tag is missing its closing }}";

    expect(insertPlaceholder("{{x}} {{y", 7, 7, "k")).toEqual({
      template: "{{x}} {{k}}{{y",
      cursor: 11,
    });
    expect(errorsOf("{{x}} {{k}}{{y")).toEqual([
      { message: missing, offset: 11 },
    ]);

    expect(insertPlaceholder("a{{x", 2, 2, "k")).toEqual({
      template: "a{{k}}{{x",
      cursor: 6,
    });
    expect(errorsOf("a{{k}}{{x")).toEqual([{ message: missing, offset: 6 }]);
  });

  it("leaves an unclosed {{ in random templates unclosed, wherever the cursor is", () => {
    const missing = "Tag is missing its closing }}";
    const random = seeded(20240613);
    let checked = 0;
    for (let i = 0; i < 2000; i++) {
      const tail = random.pick(["", "y", " a b", "#b x\n", "\\", "}", "{"]);
      const template = `${randomTemplate(random)}{{${tail}`;
      const [error, ...more] = errorsOf(template);
      if (error?.message !== missing || more.length > 0) continue;
      checked++;
      for (let cursor = 0; cursor <= template.length; cursor++) {
        const context = `${JSON.stringify(template)} at ${cursor}`;
        const result = insertPlaceholder(template, cursor, cursor, "k");
        const at = result.cursor - "{{k}}".length;

        expect(result.template.slice(at, result.cursor), context).toBe("{{k}}");
        if (cursor < error.offset + "{{".length) {
          // The chip goes before the `{{`, which stays unclosed.
          const added = result.template.length - template.length;
          expect(errorsOf(result.template), context).toEqual([
            { message: missing, offset: error.offset + added },
          ]);
        } else {
          expect(parseTemplate(result.template).ok, context).toBe(false);
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("works at the start and at the end", () => {
    expect(insertPlaceholder("ab", 0, 0, "goal")).toEqual({
      template: "{{goal}}ab",
      cursor: 8,
    });
    expect(insertPlaceholder("ab", 2, 2, "goal")).toEqual({
      template: "ab{{goal}}",
      cursor: 10,
    });
  });

  it("replaces a selection", () => {
    expect(insertPlaceholder("a123b", 1, 4, "goal")).toEqual({
      template: "a{{goal}}b",
      cursor: 9,
    });
  });

  it("keeps a backslash before it a backslash", () => {
    const { template, cursor } = insertPlaceholder("C:\\", 3, 3, "goal");

    expect(parseTemplate(template).ok).toBe(true);
    expect(renderTemplate(template, values)).toBe("C:\\VALUE");
    expect(cursor).toBe(template.length);
  });

  it("keeps a run of backslashes as many backslashes", () => {
    const { template } = insertPlaceholder("\\\\x", 2, 2, "goal");

    expect(renderTemplate(template, values)).toBe("\\\\VALUEx");
  });

  it("leaves a backslash after it alone", () => {
    const { template } = insertPlaceholder("\\\\{{x}}", 0, 0, "goal");

    expect(renderTemplate(template, { ...values, x: "X" })).toBe("VALUE\\X");
  });

  it("parts the tag from a brace before it", () => {
    const { template, cursor } = insertPlaceholder("a{b", 2, 2, "goal");

    expect(parseTemplate(template).ok).toBe(true);
    expect(renderTemplate(template, values)).toBe("a{ VALUEb");
    expect(template.slice(0, cursor)).toBe("a{ {{goal}}");
  });

  it("needs no space before a brace after it", () => {
    const { template, cursor } = insertPlaceholder("a}b", 1, 1, "goal");

    expect(template).toBe("a{{goal}}}b");
    expect(renderTemplate(template, values)).toBe("aVALUE}b");
    expect(template.slice(0, cursor)).toBe("a{{goal}}");
  });

  it("keeps empty braces tight around the tag", () => {
    const { template } = insertPlaceholder("Return JSON {}", 13, 13, "goal");

    expect(template).toBe("Return JSON { {{goal}}}");
    expect(renderTemplate(template, values)).toBe("Return JSON { VALUE}");
  });

  it("checks the neighbours of a selection, not the text it replaces", () => {
    const { template } = insertPlaceholder("x{abc}y", 2, 5, "goal");

    expect(renderTemplate(template, values)).toBe("x{ VALUE}y");
  });

  it("goes before an escape rather than between it and the braces", () => {
    expect(insertPlaceholder("\\{{x}}", 1, 1, "goal")).toEqual({
      template: "{{goal}}\\{{x}}",
      cursor: 8,
    });
    expect(insertPlaceholder("a\\\\{{b}}", 2, 2, "goal").template).toBe(
      "a{{goal}}\\\\{{b}}",
    );
  });

  it("goes before an escape when the cursor is inside its braces", () => {
    expect(insertPlaceholder("\\{{y}}", 2, 2, "z")).toEqual({
      template: "{{z}}\\{{y}}",
      cursor: 5,
    });
  });

  it("needs no space after an escaped {{", () => {
    expect(insertPlaceholder("\\{{y}}", 3, 3, "z")).toEqual({
      template: "\\{{{{z}}y}}",
      cursor: 8,
    });
    expect(insertPlaceholder("\\{{abc}}", 3, 6, "z").template).toBe(
      "\\{{{{z}}}}",
    );
  });

  it("goes after a tag the cursor is inside", () => {
    expect(insertPlaceholder("{{goal}}", 4, 4, "context")).toEqual({
      template: "{{goal}}{{context}}",
      cursor: 19,
    });
  });

  it("replaces nothing when the selection reaches into a tag", () => {
    expect(insertPlaceholder("ab{{x}}cd", 1, 4, "goal")).toEqual({
      template: "ab{{x}}{{goal}}cd",
      cursor: 15,
    });
    expect(insertPlaceholder("ab{{x}}cd", 4, 8, "goal")).toEqual({
      template: "ab{{x}}c{{goal}}d",
      cursor: 16,
    });
  });

  it("keeps the meaning of every tag and escape, wherever the cursor is", () => {
    const keys = { a: "A", b: "B", c: "C", k: "" };
    const templates = [
      "",
      "plain text",
      "{{a}}",
      "\\{{a}}",
      "\\\\{{a}}",
      "\\\\\\{{a}}",
      "\\\\\\\\{{a}}",
      "a\\{{b}}c and \\\\{{c}}",
      "{{a}}\\{{b}}\\\\{{c}}",
      "C:\\ and \\\\x then {{a}}",
      "{{#a}}x {{b}} y{{/a}}",
      "{{ a }} and {{# b }}\\{{c}}{{/ b }}",
      "{{#a}}\n{{#b}}{{c}}{{/b}}\n{{/a}}",
      "a{b}c {x} {{a}}}",
      "\\{{{a}} {{a}}{",
      "{ {{a}} }",
      "\\{{y}} and \\\\\\{{y}}",
      "\\{x} \\{{{{a}}}",
    ];

    /** Checks inserting `{{k}}` in place of `template[start, end)`. */
    const check = (template: string, start: number, end: number) => {
      const context = `${JSON.stringify(template)} at ${start}-${end}`;
      const result = insertPlaceholder(template, start, end, "k");
      const at = result.cursor - "{{k}}".length;

      expect(result.template.slice(at, result.cursor), context).toBe("{{k}}");
      expect(parseTemplate(result.template).ok, context).toBe(true);
      const used = usedKeys(result.template);
      for (const key of usedKeys(template)) {
        expect(used.has(key), context).toBe(true);
      }
      expect(used.has("k"), context).toBe(true);

      const before = renderTemplate(template, keys);
      const after = renderTemplate(result.template, keys);
      // Only a space before the tag may change what renders, and only when
      // without it a brace would join the tag's own.
      if (result.template.slice(at - 2, at) === "{ ") {
        const joined =
          result.template.slice(0, at - 1) + result.template.slice(at);
        const stands = parseTemplate(joined).ok && usedKeys(joined).has("k");
        expect(stands, context).toBe(false);
        expect(after.replace(/ /g, ""), context).toBe(before.replace(/ /g, ""));
        expect(after.length, context).toBeLessThanOrEqual(before.length + 1);
      } else {
        expect(after, context).toBe(before);
      }
    };

    for (const template of templates) {
      for (let at = 0; at <= template.length; at++) {
        check(template, at, at);
      }
    }
    // Selections with an end inside a tag or an escape replace nothing.
    check("a\\{{b}}c", 2, 4);
    check("a\\\\{{b}}c", 0, 3);
    check("{{#a}}x {{b}} y{{/a}}", 3, 10);
    check("{{a}} {{b}}", 2, 4);
    check("x \\\\\\{{a}}", 1, 4);
  });

  it("keeps how random templates render, wherever the cursor is", () => {
    const random = seeded(20240612);
    let parsed = 0;
    for (let i = 0; i < 20000; i++) {
      const template = randomTemplate(random);
      if (!parseTemplate(template).ok) continue;
      parsed++;
      const values = randomValues(random);
      const cursor = random.below(template.length + 1);
      const context = `${JSON.stringify(template)} at ${cursor}`;
      const result = insertPlaceholder(template, cursor, cursor, "n");
      const at = result.cursor - "{{n}}".length;

      expect(result.template.slice(at, result.cursor), context).toBe("{{n}}");
      expect(parseTemplate(result.template).ok, context).toBe(true);
      const before = renderTemplate(template, values);
      // Only the space that parts the tag from a brace before it may show.
      // A value for the new key marks where the tag renders, if its block
      // shows at all; with the mark and that space taken out, nothing else
      // may differ.
      const added = result.template.length - template.length - "{{n}}".length;
      if (added === 1 && result.template.slice(at - 2, at) === "{ ") {
        const marked = renderTemplate(result.template, { ...values, n: "@" });
        expect(marked.replace("{ @", "{"), context).toBe(before);
      } else {
        expect(renderTemplate(result.template, values), context).toBe(before);
      }
    }
    expect(parsed).toBeGreaterThan(10000);
  });
});
