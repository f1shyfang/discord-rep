// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MessageBody } from "~/components/chat/MessageBody";
afterEach(cleanup);
it("renders hostile HTML and script URLs as escaped text", () => {
  const { container } = render(
    <MessageBody
      body={
        "<img src=x onerror=alert(1)> [click](javascript:alert(1)) <script>evil()</script>"
      }
    />,
  );
  expect(container.querySelector("img, script, a")).toBeNull();
  expect(container.textContent).toContain("<script>evil()</script>");
});
it("supports safe links, code and recognized mentions without HTML evaluation", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const { container } = render(
    <MessageBody
      body={`**hello** [website](https://example.com) \`<img>\` <@${id}>`}
      people={[{ id, displayName: "Jane" }]}
    />,
  );
  expect(container.querySelector("strong")?.textContent).toBe("hello");
  expect(screen.getByRole("link", { name: "website" })).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  );
  expect(container.querySelector("code")?.textContent).toBe("<img>");
  expect(container.querySelector("mark")?.textContent).toBe("@Jane");
});
