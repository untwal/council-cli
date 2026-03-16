import { describe, it, expect } from "vitest";

// Test the markdownToHtml and escapeHtml functions
// They're private in export.ts, so we test the patterns directly

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function markdownToHtml(md: string): string {
  const escaped = escapeHtml(md);
  let html = escaped
    .replace(/^### (.+)$/gm, "<h4>$1</h4>")
    .replace(/^## (.+)$/gm, "<h3>$1</h3>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^\[x\]/gm, "&#9745;")
    .replace(/^\[ \]/gm, "&#9744;");

  const lines = html.split("\n");
  const result: string[] = [];
  let inList = false;
  for (const line of lines) {
    const bulletMatch = line.match(/^- (.+)$/);
    if (bulletMatch) {
      if (!inList) { result.push("<ul>"); inList = true; }
      result.push(`<li>${bulletMatch[1]}</li>`);
    } else {
      if (inList) { result.push("</ul>"); inList = false; }
      result.push(line);
    }
  }
  if (inList) result.push("</ul>");
  return result.join("\n");
}

describe("escapeHtml", () => {
  it("escapes HTML special characters", () => {
    expect(escapeHtml("<script>alert('xss')</script>")).toBe("&lt;script&gt;alert('xss')&lt;/script&gt;");
  });

  it("escapes ampersands", () => {
    expect(escapeHtml("foo & bar")).toBe("foo &amp; bar");
  });

  it("escapes quotes", () => {
    expect(escapeHtml('say "hello"')).toBe("say &quot;hello&quot;");
  });

  it("handles empty string", () => {
    expect(escapeHtml("")).toBe("");
  });
});

describe("markdownToHtml", () => {
  it("converts h2 headers", () => {
    expect(markdownToHtml("## Summary")).toContain("<h3>Summary</h3>");
  });

  it("converts h3 headers", () => {
    expect(markdownToHtml("### Details")).toContain("<h4>Details</h4>");
  });

  it("converts bold text", () => {
    expect(markdownToHtml("**important**")).toContain("<strong>important</strong>");
  });

  it("converts inline code", () => {
    expect(markdownToHtml("`code`")).toContain("<code>code</code>");
  });

  it("converts bullet list to proper ul/li", () => {
    const result = markdownToHtml("- item 1\n- item 2\n- item 3");
    expect(result).toContain("<ul>");
    expect(result).toContain("<li>item 1</li>");
    expect(result).toContain("<li>item 2</li>");
    expect(result).toContain("<li>item 3</li>");
    expect(result).toContain("</ul>");
  });

  it("closes list when non-bullet line follows", () => {
    const result = markdownToHtml("- item 1\n- item 2\nParagraph");
    expect(result).toContain("</ul>");
    expect(result).toContain("Paragraph");
  });

  it("converts checkboxes", () => {
    expect(markdownToHtml("[x] done")).toContain("&#9745;");
    expect(markdownToHtml("[ ] todo")).toContain("&#9744;");
  });

  it("escapes HTML before converting markdown", () => {
    const result = markdownToHtml("## <script>alert('xss')</script>");
    expect(result).not.toContain("<script>");
    expect(result).toContain("&lt;script&gt;");
  });

  it("handles empty input", () => {
    expect(markdownToHtml("")).toBe("");
  });

  it("handles multiple lists separated by text", () => {
    const result = markdownToHtml("- a\n- b\nText\n- c\n- d");
    const ulCount = (result.match(/<ul>/g) ?? []).length;
    expect(ulCount).toBe(2);
  });
});
